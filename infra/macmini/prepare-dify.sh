#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_command git
require_command python3
require_command docker
require_loopback_host "$DIFY_BIND_ADDRESS" "Dify"

if [[ -d "$DIFY_ROOT_DIR/.git" ]]; then
  # 脚本只允许自己生成的“插件调试端口改为回环地址”和
  # “Qdrant 文件句柄上限”两处变更。
  # 其他 Dify 修改仍会立即停止，防止覆盖用户工作。
  python3 - "$DIFY_ROOT_DIR" <<'PY'
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
status = subprocess.check_output(
    ["git", "-C", str(root), "status", "--porcelain"], text=True
).splitlines()
allowed_status = " M docker/docker-compose.yaml"
unexpected = [line for line in status if line != allowed_status]
if unexpected:
    raise SystemExit("Dify 目录有未保存修改：" + ", ".join(unexpected))
if allowed_status in status:
    original = subprocess.check_output(
        ["git", "-C", str(root), "show", "HEAD:docker/docker-compose.yaml"],
        text=True,
    )
    old = '      - "${EXPOSE_PLUGIN_DEBUGGING_PORT:-5003}:${PLUGIN_DEBUGGING_PORT:-5003}"'
    new = '      - "127.0.0.1:${EXPOSE_PLUGIN_DEBUGGING_PORT:-5003}:${PLUGIN_DEBUGGING_PORT:-5003}"'
    qdrant_key = "      QDRANT_API_KEY: ${QDRANT_API_KEY:-difyai123456}"
    qdrant_limits = qdrant_key + """
    ulimits:
      nofile:
        soft: 65536
        hard: 65536"""
    expected_without_limits = original.replace(old, new, 1)
    expected = expected_without_limits.replace(
        qdrant_key,
        qdrant_limits,
        1,
    )
    current = (root / "docker/docker-compose.yaml").read_text(encoding="utf-8")
    if current not in {expected_without_limits, expected}:
        raise SystemExit("Dify docker-compose.yaml 包含脚本之外的修改")
PY
  current_tag="$(git -C "$DIFY_ROOT_DIR" describe --tags --exact-match 2>/dev/null || true)"
  if [[ "$current_tag" != "$DIFY_VERSION" ]]; then
    log "切换 Dify 到 $DIFY_VERSION"
    git -C "$DIFY_ROOT_DIR" fetch --depth 1 origin "refs/tags/$DIFY_VERSION:refs/tags/$DIFY_VERSION"
    git -C "$DIFY_ROOT_DIR" checkout --detach "$DIFY_VERSION"
  else
    log "Dify $DIFY_VERSION 已准备"
  fi
elif [[ -d "$DIFY_ROOT_DIR/docker" && -f "$DIFY_ROOT_DIR/docker/docker-compose.yaml" && -f "$DIFY_ROOT_DIR/docker/.env.example" ]]; then
  version_marker="$DIFY_ROOT_DIR/.tokensoff-dify-version"
  if [[ -f "$version_marker" ]]; then
    bundle_version="$(tr -d '[:space:]' <"$version_marker")"
    [[ "$bundle_version" == "$DIFY_VERSION" ]] || die "Dify bundle 版本是 $bundle_version，不是期望的 $DIFY_VERSION"
  else
    install -m 600 /dev/null "$version_marker"
    printf '%s\n' "$DIFY_VERSION" >"$version_marker"
  fi
  log "Dify $DIFY_VERSION docker bundle 已通过版本标记校验"
elif [[ -e "$DIFY_ROOT_DIR" ]]; then
  die "Dify 目录既不是官方 Git 仓库，也不是带版本标记的 docker bundle：$DIFY_ROOT_DIR"
else
  mkdir -p "$(dirname "$DIFY_ROOT_DIR")"
  log "正在下载 Dify $DIFY_VERSION"
  git clone --branch "$DIFY_VERSION" --depth 1 https://github.com/langgenius/dify.git "$DIFY_ROOT_DIR"
fi

DIFY_DOCKER_DIR="$DIFY_ROOT_DIR/docker"
DIFY_ENV_FILE="$DIFY_DOCKER_DIR/.env"
[[ -f "$DIFY_DOCKER_DIR/.env.example" ]] || die "Dify 仓库中没有 docker/.env.example"

if [[ ! -f "$DIFY_ENV_FILE" ]]; then
  install -m 600 "$DIFY_DOCKER_DIR/.env.example" "$DIFY_ENV_FILE"
  log "已创建 Dify 本机配置：$DIFY_ENV_FILE"
fi

python3 - "$DIFY_ENV_FILE" <<'PY'
import os
import hashlib
import pathlib
import secrets
import sys
import urllib.parse

path = pathlib.Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
existing = {}
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        existing[key] = value

# 用哈希识别官方模板中的公开默认值，避免把它们当成生产密钥沿用。
unsafe_hashes = {
    "DB_PASSWORD": {"b8ba9c61cc9ff699c426c75e748fcf200e8b47869d76fde8bb36ec2f7a34f038"},
    "REDIS_PASSWORD": {"b8ba9c61cc9ff699c426c75e748fcf200e8b47869d76fde8bb36ec2f7a34f038"},
    "SECRET_KEY": set(),
    "PLUGIN_DAEMON_KEY": {"481c0ab8a6f9e9dcb9391fb1c8b649d19f493c5253e4dc20c2c32ec21875b8ab"},
    "PLUGIN_DIFY_INNER_API_KEY": {"217ef27f7b2a2f8949eb2e0973f7dfa099f887427b9a6626b2395e2417239ff2"},
    "QDRANT_API_KEY": {"b8ba9c61cc9ff699c426c75e748fcf200e8b47869d76fde8bb36ec2f7a34f038"},
}

def secret_value(env_name: str, file_name: str) -> str:
    override = os.environ.get(env_name, "")
    if override:
        return override
    current = existing.get(file_name, "")
    current_hash = hashlib.sha256(current.encode("utf-8")).hexdigest() if current else ""
    if current and current_hash not in unsafe_hashes[file_name]:
        return current
    return secrets.token_urlsafe(48)

redis_password = secret_value("DIFY_REDIS_PASSWORD", "REDIS_PASSWORD")
redis_username = existing.get("REDIS_USERNAME", "")
redis_host = existing.get("REDIS_HOST", "redis") or "redis"
redis_port = existing.get("REDIS_PORT", "6379") or "6379"
existing_broker = urllib.parse.urlsplit(existing.get("CELERY_BROKER_URL", ""))
redis_broker_db = existing_broker.path.lstrip("/") or "1"
encoded_user = urllib.parse.quote(redis_username, safe="")
encoded_password = urllib.parse.quote(redis_password, safe="")
broker_auth = f"{encoded_user}:{encoded_password}@" if encoded_user else f":{encoded_password}@"

updates = {
    "VECTOR_STORE": "qdrant",
    "QDRANT_URL": "http://qdrant:6333",
    "COMPOSE_PROFILES": "qdrant,postgresql",
    "ENABLE_COLLABORATION_MODE": "false",
    "CELERY_WORKER_AMOUNT": "1",
    "SQLALCHEMY_POOL_SIZE": "10",
    "SQLALCHEMY_MAX_OVERFLOW": "10",
    "SECRET_KEY": secret_value("DIFY_SECRET_KEY", "SECRET_KEY"),
    "DB_PASSWORD": secret_value("DIFY_DB_PASSWORD", "DB_PASSWORD"),
    "REDIS_PASSWORD": redis_password,
    "CELERY_BROKER_URL": f"redis://{broker_auth}{redis_host}:{redis_port}/{redis_broker_db}",
    "PLUGIN_DAEMON_KEY": secret_value("DIFY_PLUGIN_DAEMON_KEY", "PLUGIN_DAEMON_KEY"),
    "PLUGIN_DIFY_INNER_API_KEY": secret_value("DIFY_PLUGIN_INNER_API_KEY", "PLUGIN_DIFY_INNER_API_KEY"),
    "QDRANT_API_KEY": secret_value("DIFY_QDRANT_API_KEY", "QDRANT_API_KEY"),
    "EXPOSE_NGINX_PORT": f'{os.environ.get("DIFY_BIND_ADDRESS", "127.0.0.1")}:{os.environ.get("DIFY_PORT", "8000")}',
    "EXPOSE_NGINX_SSL_PORT": f'{os.environ.get("DIFY_BIND_ADDRESS", "127.0.0.1")}:{os.environ.get("DIFY_SSL_PORT", "8443")}',
    # 这个值同时会被 API 解析为整数，因此保持纯数字。
    # 对外绑定地址在下方的 compose ports 中单独改为 127.0.0.1。
    "EXPOSE_PLUGIN_DEBUGGING_PORT": os.environ.get("DIFY_PLUGIN_DEBUG_PORT", "5003"),
}

seen = set()
output = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        output.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")
path.write_text("\n".join(output) + "\n", encoding="utf-8")
path.chmod(0o600)
PY

python3 - "$DIFY_DOCKER_DIR/docker-compose.yaml" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
old = '      - "${EXPOSE_PLUGIN_DEBUGGING_PORT:-5003}:${PLUGIN_DEBUGGING_PORT:-5003}"'
new = '      - "127.0.0.1:${EXPOSE_PLUGIN_DEBUGGING_PORT:-5003}:${PLUGIN_DEBUGGING_PORT:-5003}"'
if new not in text:
    if old not in text:
        raise SystemExit("Dify compose 中未找到预期的插件调试端口配置")
    text = text.replace(old, new, 1)
qdrant_key = "      QDRANT_API_KEY: ${QDRANT_API_KEY:-difyai123456}"
qdrant_limits = qdrant_key + """
    ulimits:
      nofile:
        soft: 65536
        hard: 65536"""
if qdrant_limits not in text:
    if qdrant_key not in text:
        raise SystemExit("Dify compose 中未找到预期的 Qdrant 配置")
    text = text.replace(qdrant_key, qdrant_limits, 1)
path.write_text(text, encoding="utf-8")
PY

log "Dify 已配置为 Qdrant 低资源模式、65536 文件句柄上限，并且只监听 ${DIFY_BIND_ADDRESS}:${DIFY_PORT}"

if is_true "${START_DIFY:-true}"; then
  docker info >/dev/null 2>&1 || die "Docker/Colima 未启动"
  log "正在启动 Dify，首次会下载镜像"
  docker_compose \
    --project-directory "$DIFY_DOCKER_DIR" \
    --env-file "$DIFY_ENV_FILE" \
    -f "$DIFY_DOCKER_DIR/docker-compose.yaml" \
    up -d
  # Nginx resolves the API/Web container address when it starts. Refresh it after
  # Compose recreates either upstream so it never keeps a stale container IP.
  docker_compose \
    --project-directory "$DIFY_DOCKER_DIR" \
    --env-file "$DIFY_ENV_FILE" \
    -f "$DIFY_DOCKER_DIR/docker-compose.yaml" \
    restart nginx
fi

#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  if [[ -n "${DEPLOY_TARGET:-}" ]]; then
    MODE="remote"
  else
    MODE="local"
  fi
fi

write_runtime_env() {
  local output_file="$APP_REPO_DIR/.env.production"
  local temp_file
  temp_file="$(mktemp)"

  python3 - "$temp_file" "$output_file" <<'PY'
import os
import pathlib
import secrets
import sys

output_path = pathlib.Path(sys.argv[1])
existing_path = pathlib.Path(sys.argv[2])
existing = {}
if existing_path.is_file():
    for line in existing_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            existing[key] = value

keys = (
    "ZHIDA_TRPC_URL",
    "RAG_API_URL",
    "DIFY_API_URL",
    "DIFY_API_KEY",
    "ADVISOR_ALLOW_ANONYMOUS_PUBLIC_KB",
    "ZHIDA_AGENT_AUTHORIZE_URL",
    "ZHIDA_AGENT_EXCHANGE_URL",
    "ZHIDA_AGENT_AUDIENCE",
)
lines = []
for key in keys:
    value = os.environ.get(key, "") or existing.get(key, "")
    if "\n" in value or "\r" in value:
        raise SystemExit(f"{key} cannot contain a newline")
    lines.append(f"{key}={value}")

configured_kb_key = os.environ.get("KB_API_KEY", "")
configured_rag_key = os.environ.get("RAG_API_KEY", "")
if configured_kb_key and configured_rag_key and configured_kb_key != configured_rag_key:
    raise SystemExit("KB_API_KEY and RAG_API_KEY must match")
rag_key = (
    configured_kb_key
    or configured_rag_key
    or existing.get("RAG_API_KEY", "")
    or existing.get("KB_API_KEY", "")
    or secrets.token_urlsafe(48)
)
advisor_secret = (
    os.environ.get("ADVISOR_SESSION_SECRET", "")
    or existing.get("ADVISOR_SESSION_SECRET", "")
    or secrets.token_urlsafe(48)
)
bridge_secret = (
    os.environ.get("ZHIDA_AGENT_SESSION_SECRET", "")
    or existing.get("ZHIDA_AGENT_SESSION_SECRET", "")
    or secrets.token_urlsafe(48)
)
lines.extend(
    (
        f"KB_API_KEY={rag_key}",
        f"RAG_API_KEY={rag_key}",
        f"ADVISOR_SESSION_SECRET={advisor_secret}",
        f"ZHIDA_AGENT_SESSION_SECRET={bridge_secret}",
    )
)
output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
  install -m 600 "$temp_file" "$output_file"
  rm -f "$temp_file"
}

deploy_local() {
  [[ -f "$APP_REPO_DIR/package.json" ]] || die "项目目录不正确：$APP_REPO_DIR"
  require_command npm
  require_command python3

  if is_true "${RUN_SETUP_ON_DEPLOY:-true}"; then
    DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" "$SCRIPT_DIR/setup.sh"
  fi

  write_runtime_env

  log "安装前端依赖"
  (cd "$APP_REPO_DIR" && npm ci)
  log "构建前端"
  (cd "$APP_REPO_DIR" && npm run build)

  if [[ -d "$KB_WORKDIR" ]]; then
    log "安装知识库服务依赖"
    python3 -m venv "$KB_WORKDIR/.venv"
    "$KB_WORKDIR/.venv/bin/python" -m pip install --upgrade pip
    if [[ -f "$KB_WORKDIR/requirements.txt" ]]; then
      "$KB_WORKDIR/.venv/bin/pip" install -r "$KB_WORKDIR/requirements.txt"
    elif [[ -f "$KB_WORKDIR/pyproject.toml" ]]; then
      "$KB_WORKDIR/.venv/bin/pip" install "$KB_WORKDIR"
    else
      die "知识库目录存在，但没有 requirements.txt 或 pyproject.toml"
    fi
  else
    warn "尚未找到知识库服务：$KB_WORKDIR"
  fi

  if is_true "${START_DIFY:-true}"; then
    DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" "$SCRIPT_DIR/prepare-dify.sh"
  fi

  if is_true "${INSTALL_LAUNCH_AGENTS:-true}"; then
    DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" "$SCRIPT_DIR/install-launch-agents.sh"
  fi

  if is_true "${PULL_OLLAMA_MODEL:-true}"; then
    log "准备 Ollama 向量模型：$OLLAMA_MODEL"
    for _ in $(seq 1 30); do
      if curl -fsS "http://$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
    OLLAMA_HOST="$OLLAMA_HOST" ollama pull "$OLLAMA_MODEL"
  fi

  log "本机构建和常驻服务安装完成"
}

deploy_remote() {
  [[ -n "${DEPLOY_TARGET:-}" ]] || die "远程部署需要在 env.local 填 DEPLOY_TARGET"
  [[ "$APP_REPO_DIR" = /* ]] || die "远程部署时 APP_REPO_DIR 必须是 Mac mini 上的绝对路径"
  [[ -f "$DEPLOY_ENV_FILE" ]] || die "未找到部署配置：$DEPLOY_ENV_FILE"
  require_command rsync
  require_command ssh

  local remote_repo_q
  local remote_env_q
  printf -v remote_repo_q '%q' "$APP_REPO_DIR"
  printf -v remote_env_q '%q' "$APP_REPO_DIR/infra/macmini/env.local"

  log "创建 Mac mini 目标目录"
  # 参数已经由 printf %q 在本地转义，再交给远程 shell。
  # shellcheck disable=SC2029
  ssh "$DEPLOY_TARGET" "mkdir -p $remote_repo_q"

  log "同步项目文件（不删除服务器现有文件，不上传开发机密钥）"
  rsync -az \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.next/' \
    --exclude 'dist/' \
    --exclude '.wrangler/' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'infra/macmini/env.local' \
    "$PROJECT_ROOT/" "$DEPLOY_TARGET:$APP_REPO_DIR/"

  rsync -az "$DEPLOY_ENV_FILE" "$DEPLOY_TARGET:$APP_REPO_DIR/infra/macmini/env.local"
  # macOS 自带的旧版 rsync 不支持 GNU 风格的 --chmod=F600；上传后在目标机收紧权限。
  # shellcheck disable=SC2029
  ssh "$DEPLOY_TARGET" "chmod 600 $remote_env_q"

  log "在 Mac mini 上安装、构建并启动"
  # shellcheck disable=SC2029
  ssh "$DEPLOY_TARGET" "cd $remote_repo_q && DEPLOY_ENV_FILE=$remote_env_q ./infra/macmini/deploy.sh local"
}

main() {
  case "$MODE" in
    local) deploy_local ;;
    remote) deploy_remote ;;
    *) die "用法：$0 [local|remote]" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi

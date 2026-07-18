#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_loopback_host "$APP_HOST" "前端"
cd "$APP_REPO_DIR"

# vinext start 不保证像 Next.js 一样在运行期自动加载 .env.production。
# 显式加载服务器端配置，确保会话签名、RAG 与 Dify 密钥只进入前端服务进程。
if [[ -f "$APP_REPO_DIR/.env.production" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_REPO_DIR/.env.production"
  set +a
fi

exec npm run start -- --hostname "$APP_HOST" --port "$APP_PORT"

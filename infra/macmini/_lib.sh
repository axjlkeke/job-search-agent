#!/usr/bin/env bash

set -Eeuo pipefail

MACMINI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$MACMINI_DIR/../.." && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$MACMINI_DIR/env.local}"

export PATH="$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
  set +a
fi

APP_REPO_DIR="${APP_REPO_DIR:-$PROJECT_ROOT}"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-3000}"
KB_HOST="${KB_HOST:-127.0.0.1}"
KB_PORT="${KB_PORT:-8001}"
KB_HEALTH_PATH="${KB_HEALTH_PATH:-/health}"
KB_WORKDIR="${KB_WORKDIR:-$APP_REPO_DIR/services/knowledge-base}"
KB_APP_MODULE="${KB_APP_MODULE:-app.main:app}"
KB_DATA_DIR="${KB_DATA_DIR:-$HOME/.local/share/tokensoff/kb}"
KB_DB_PATH="${KB_DB_PATH:-$KB_DATA_DIR/knowledge.db}"
JOB_AGENT_WORKSPACE_DIR="${JOB_AGENT_WORKSPACE_DIR:-$HOME/.local/share/tokensoff/workspaces}"
export JOB_AGENT_WORKSPACE_DIR
KB_VISION_OCR_PATH="${KB_VISION_OCR_PATH:-$HOME/.local/bin/tokensoff-vision-ocr}"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3-embedding:0.6b}"
COLIMA_CPU="${COLIMA_CPU:-4}"
COLIMA_MEMORY_GB="${COLIMA_MEMORY_GB:-8}"
COLIMA_DISK_GB="${COLIMA_DISK_GB:-30}"
DIFY_VERSION="${DIFY_VERSION:-1.15.0}"
DIFY_ROOT_DIR="${DIFY_ROOT_DIR:-$HOME/Services/dify}"
DIFY_BIND_ADDRESS="${DIFY_BIND_ADDRESS:-127.0.0.1}"
DIFY_PORT="${DIFY_PORT:-8000}"
DIFY_SSL_PORT="${DIFY_SSL_PORT:-8443}"
DIFY_PLUGIN_DEBUG_PORT="${DIFY_PLUGIN_DEBUG_PORT:-5003}"
PUBLIC_HOSTNAME="${PUBLIC_HOSTNAME:-tokensoff.com}"
CLOUDFLARE_CONFIG_FILE="${CLOUDFLARE_CONFIG_FILE:-$HOME/.cloudflared/config.yml}"
LOG_DIR="${LOG_DIR:-$HOME/Library/Logs/tokensoff}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Backups/tokensoff}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

log() {
  printf '[tokensoff] %s\n' "$*"
}

warn() {
  printf '[tokensoff] 提醒：%s\n' "$*" >&2
}

die() {
  printf '[tokensoff] 失败：%s\n' "$*" >&2
  exit 1
}

is_true() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "缺少 Docker Compose"
  fi
}

require_loopback_host() {
  case "$1" in
    127.0.0.1 | localhost | ::1) ;;
    *) die "$2 必须绑定本机回环地址，当前是：$1" ;;
  esac
}

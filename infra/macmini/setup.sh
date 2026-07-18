#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

ensure_formula() {
  local command_name="$1"
  local formula_name="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    log "$command_name 已安装"
    return
  fi

  log "正在安装 $formula_name"
  "$BREW_BIN" install "$formula_name"
}

if ! command -v brew >/dev/null 2>&1; then
  die "这台 Mac 还没有 Homebrew。请先打开 https://brew.sh 按官方步骤安装，再重新运行本脚本。"
fi

BREW_BIN="$(command -v brew)"
log "使用 Homebrew：$BREW_BIN"

ensure_formula node node
ensure_formula python3 python
ensure_formula ollama ollama
ensure_formula cloudflared cloudflared
ensure_formula colima colima
ensure_formula rsync rsync
ensure_formula tesseract tesseract

# Docker Desktop 如果已能用就保持原状；它未启动或首启受阻时，使用无 sudo 的 Colima。
if ! command -v docker >/dev/null 2>&1; then
  log "正在安装 Docker 命令行客户端（不重装 Docker Desktop）"
  "$BREW_BIN" install docker docker-compose
fi

if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  log "正在安装 Docker Compose"
  "$BREW_BIN" install docker-compose
fi

mkdir -p \
  "$APP_REPO_DIR" \
  "$KB_DATA_DIR" \
  "$LOG_DIR" \
  "$BACKUP_DIR" \
  "$HOME/.cloudflared" \
  "$HOME/Library/LaunchAgents"

chmod 700 "$HOME/.cloudflared"

if is_true "${PREPARE_KB_OCR:-true}"; then
  DEPLOY_ENV_FILE="$DEPLOY_ENV_FILE" "$SCRIPT_DIR/prepare-kb-ocr.sh"
fi

if is_true "${START_CONTAINER_ENGINE:-true}"; then
  if docker info >/dev/null 2>&1; then
    log "Docker 容器引擎已可用，不启动其他引擎"
  else
    log "Docker daemon 不可用，正在启动 Colima（${COLIMA_CPU} CPU / ${COLIMA_MEMORY_GB}GB / ${COLIMA_DISK_GB}GB）"
    colima start \
      --cpu "$COLIMA_CPU" \
      --memory "$COLIMA_MEMORY_GB" \
      --disk "$COLIMA_DISK_GB" \
      --vm-type vz \
      --mount-type virtiofs
    docker context use colima >/dev/null 2>&1 || true
    docker info >/dev/null 2>&1 || die "Colima 已启动，但 Docker 仍不可用"
  fi
fi

log "基础环境已准备好。本脚本没有修改 VPS，也没有需要 sudo。"

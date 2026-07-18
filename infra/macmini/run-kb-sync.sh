#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

[[ -x "$KB_WORKDIR/.venv/bin/python" ]] || die "知识库虚拟环境未安装"
mkdir -p "$KB_DATA_DIR"

lock_dir="$KB_DATA_DIR/.batch-sync.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  warn "已有知识库批量同步正在运行，本次跳过"
  exit 0
fi
trap 'rmdir "$lock_dir" >/dev/null 2>&1 || true' EXIT

limit="${KB_SYNC_SOURCE_LIMIT:-20}"
if [[ ! "$limit" =~ ^[0-9]+$ ]] || (( limit < 1 || limit > 50 )); then
  die "KB_SYNC_SOURCE_LIMIT 必须是 1 到 50 的整数"
fi
reconcile_limit="${KB_DIFY_RECONCILE_LIMIT:-200}"
if [[ ! "$reconcile_limit" =~ ^[0-9]+$ ]] || (( reconcile_limit < 1 || reconcile_limit > 500 )); then
  die "KB_DIFY_RECONCILE_LIMIT 必须是 1 到 500 的整数"
fi

export KB_DATABASE_PATH="$KB_DB_PATH"
export KB_ALLOW_FAKE_IP_DNS="${KB_ALLOW_FAKE_IP_DNS:-false}"
export KB_PROXY_URL="${KB_PROXY_URL:-}"
export KB_VISION_OCR_PATH="${KB_VISION_OCR_PATH:-}"
export KB_TESSERACT_PATH="${KB_TESSERACT_PATH:-}"
export KB_TESSDATA_DIR="${KB_TESSDATA_DIR:-}"
export KB_OCR_TIMEOUT_SECONDS="${KB_OCR_TIMEOUT_SECONDS:-90}"
export KB_OCR_MAX_IMAGES="${KB_OCR_MAX_IMAGES:-3}"
export KB_OCR_TRIGGER_CHARS="${KB_OCR_TRIGGER_CHARS:-200}"
export DIFY_API_URL="${DIFY_API_URL:-}"
export DIFY_DATASET_ID="${DIFY_DATASET_ID:-}"
export DIFY_DATASET_API_KEY="${DIFY_DATASET_API_KEY:-}"

cd "$KB_WORKDIR"
sync_status=0
reconcile_status=0
coverage_status=0
"$KB_WORKDIR/.venv/bin/python" -m app.cli sync --all --limit-sources "$limit" || sync_status=$?
"$KB_WORKDIR/.venv/bin/python" -m app.cli dify-reconcile --limit "$reconcile_limit" || reconcile_status=$?
"$KB_WORKDIR/.venv/bin/python" -m app.cli coverage --stale-after-days 14 || coverage_status=$?

if (( sync_status != 0 || reconcile_status != 0 || coverage_status != 0 )); then
  warn "知识库同步、Dify 对账或覆盖率检查存在异常（sync=$sync_status, reconcile=$reconcile_status, coverage=$coverage_status）"
  exit 1
fi

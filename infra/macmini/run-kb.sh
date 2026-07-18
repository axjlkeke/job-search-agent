#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_loopback_host "$KB_HOST" "知识库"
[[ -d "$KB_WORKDIR" ]] || die "知识库目录不存在：$KB_WORKDIR"
[[ -x "$KB_WORKDIR/.venv/bin/uvicorn" ]] || die "知识库虚拟环境未安装"

runtime_rag_key=""
if [[ -f "$APP_REPO_DIR/.env.production" ]]; then
  runtime_rag_key="$(python3 - "$APP_REPO_DIR/.env.production" <<'PY'
import pathlib
import sys

for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    if line.startswith("RAG_API_KEY="):
        print(line.split("=", 1)[1])
        break
PY
)"
fi

mkdir -p "$KB_DATA_DIR"
export KB_DATABASE_PATH="$KB_DB_PATH"
export KB_API_KEY="${KB_API_KEY:-${RAG_API_KEY:-$runtime_rag_key}}"
export DIFY_API_URL="${DIFY_API_URL:-}"
export DIFY_DATASET_ID="${DIFY_DATASET_ID:-}"
export DIFY_DATASET_API_KEY="${DIFY_DATASET_API_KEY:-}"
export KB_VISION_OCR_PATH="${KB_VISION_OCR_PATH:-}"
cd "$KB_WORKDIR"
exec "$KB_WORKDIR/.venv/bin/uvicorn" "$KB_APP_MODULE" --host "$KB_HOST" --port "$KB_PORT" --proxy-headers

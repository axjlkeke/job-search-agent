#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

case "$OLLAMA_HOST" in
  127.0.0.1:* | localhost:* | \[::1\]:*) ;;
  *) die "OLLAMA_HOST 必须绑定本机回环地址" ;;
esac

export OLLAMA_HOST
exec ollama serve


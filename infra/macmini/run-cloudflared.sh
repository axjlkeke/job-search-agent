#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

[[ -f "$CLOUDFLARE_CONFIG_FILE" ]] || die "Cloudflare Tunnel 配置不存在：$CLOUDFLARE_CONFIG_FILE"
exec cloudflared tunnel --config "$CLOUDFLARE_CONFIG_FILE" run


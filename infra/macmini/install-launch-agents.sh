#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_command python3
require_command plutil

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

render_template() {
  local source_file="$1"
  local target_file="$2"
  python3 - "$source_file" "$target_file" "$APP_REPO_DIR" "$LOG_DIR" <<'PY'
import pathlib
import sys
from xml.sax.saxutils import escape

source, target, project_dir, log_dir = sys.argv[1:]
text = pathlib.Path(source).read_text(encoding="utf-8")
text = text.replace("__PROJECT_DIR__", escape(project_dir))
text = text.replace("__LOG_DIR__", escape(log_dir))
path = pathlib.Path(target)
path.write_text(text, encoding="utf-8")
path.chmod(0o600)
PY
  plutil -lint "$target_file" >/dev/null
}

install_agent() {
  local label="$1"
  local kickstart="${2:-true}"
  local template="$SCRIPT_DIR/launchd/$label.plist.template"
  local target="$HOME/Library/LaunchAgents/$label.plist"

  render_template "$template" "$target"
  launchctl bootout "gui/$(id -u)" "$target" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$target"
  launchctl enable "gui/$(id -u)/$label"
  if is_true "$kickstart"; then
    launchctl kickstart -k "gui/$(id -u)/$label"
  fi
  log "已安装：$label"
}

render_cloudflare_config() {
  [[ -n "${CLOUDFLARE_TUNNEL_ID:-}" ]] || die "ENABLE_CLOUDFLARE_TUNNEL=true，但未填 CLOUDFLARE_TUNNEL_ID"
  [[ -f "${CLOUDFLARE_CREDENTIALS_FILE:-}" ]] || die "Cloudflare 凭据文件不存在：${CLOUDFLARE_CREDENTIALS_FILE:-未设置}"
  require_loopback_host "$APP_HOST" "Cloudflare 前端上游"
  mkdir -p "$(dirname "$CLOUDFLARE_CONFIG_FILE")"
  python3 - \
    "$SCRIPT_DIR/cloudflared/config.yml.example" \
    "$CLOUDFLARE_CONFIG_FILE" \
    "$CLOUDFLARE_TUNNEL_ID" \
    "$CLOUDFLARE_CREDENTIALS_FILE" \
    "$PUBLIC_HOSTNAME" \
    "$APP_PORT" <<'PY'
import pathlib
import sys

source, target, tunnel_id, credentials_file, hostname, app_port = sys.argv[1:]
for value, label in ((tunnel_id, "tunnel id"), (credentials_file, "credentials file"), (hostname, "hostname"), (app_port, "port")):
    if "\n" in value or "\r" in value:
        raise SystemExit(f"invalid newline in {label}")
text = pathlib.Path(source).read_text(encoding="utf-8")
text = text.replace("__TUNNEL_ID__", tunnel_id)
text = text.replace("__CREDENTIALS_FILE__", credentials_file)
text = text.replace("__PUBLIC_HOSTNAME__", hostname)
text = text.replace("__APP_PORT__", app_port)
path = pathlib.Path(target)
path.write_text(text, encoding="utf-8")
path.chmod(0o600)
PY
  log "Cloudflare 配置已生成：$CLOUDFLARE_CONFIG_FILE"
}

install_agent com.tokensoff.keepawake
install_agent com.tokensoff.colima
install_agent com.tokensoff.ollama
install_agent com.tokensoff.kb
install_agent com.tokensoff.kb-sync false
install_agent com.tokensoff.frontend

if is_true "${ENABLE_CLOUDFLARE_TUNNEL:-false}"; then
  render_cloudflare_config
  install_agent com.tokensoff.tunnel
else
  log "Cloudflare Tunnel 尚未开启，已跳过它的常驻进程"
fi

log "常驻服务已安装到当前用户，没有使用 sudo。"

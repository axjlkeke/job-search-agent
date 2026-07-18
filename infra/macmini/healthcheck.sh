#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_command curl

failures=0

check_url() {
  local name="$1"
  local url="$2"
  local code
  code="$(curl -L -sS -o /dev/null --connect-timeout 5 --max-time 15 -w '%{http_code}' "$url" || true)"
  case "$code" in
    2?? | 3??) log "正常：$name ($code)" ;;
    *) warn "异常：$name ($code) $url"; failures=$((failures + 1)) ;;
  esac
}

check_agent() {
  local label="$1"
  if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
    log "已加载：$label"
  else
    warn "未加载：$label"
    failures=$((failures + 1))
  fi
}

check_url "前端" "http://$APP_HOST:$APP_PORT/v2"
check_url "系统状态" "http://$APP_HOST:$APP_PORT/api/system/status"
check_url "知识库" "http://$KB_HOST:$KB_PORT$KB_HEALTH_PATH"
check_url "Ollama" "http://$OLLAMA_HOST/api/tags"

if is_true "${START_DIFY:-true}"; then
  check_url "Dify" "http://$DIFY_BIND_ADDRESS:$DIFY_PORT/"
fi

check_agent com.tokensoff.keepawake
check_agent com.tokensoff.colima
check_agent com.tokensoff.ollama
check_agent com.tokensoff.kb
check_agent com.tokensoff.frontend

if is_true "${ENABLE_CLOUDFLARE_TUNNEL:-false}"; then
  check_agent com.tokensoff.tunnel
  check_url "公网域名" "https://$PUBLIC_HOSTNAME/v2"
fi

if ((failures > 0)); then
  warn "共有 $failures 项未通过。日志在：$LOG_DIR"
  exit 1
fi

log "所有启用的检查项均正常"


#!/usr/bin/env bash

set -Eeuo pipefail
set +x

ACTION="${1:-preflight}"
RELEASE_DIR="${2:-}"
SERVICE_ROOT="/Users/work/Services/job-search-agent"
INCOMING_ROOT="$SERVICE_ROOT/incoming-main-beta"
BACKUP_ROOT="$SERVICE_ROOT/release-backups/main-beta"
RECEIPT_ROOT="$SERVICE_ROOT/releases"
LOG_ROOT="$SERVICE_ROOT/logs"
NODE="/opt/homebrew/bin/node"
VINEXT="$SERVICE_ROOT/node_modules/.bin/vinext"
LABEL="com.tokensoff.frontend"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
CANDIDATE_PORT="3002"
PRODUCTION_PORT="3000"

die() {
  echo "$*" >&2
  exit 1
}

canonical_path() {
  /usr/bin/python3 - "$1" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
}

manifest_value() {
  /usr/bin/python3 - "$RELEASE_DIR/release-manifest.json" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    value = json.load(handle)
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

manifest_file_hash() {
  /usr/bin/python3 - "$RELEASE_DIR/release-manifest.json" "$1" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    manifest = json.load(handle)
for entry in manifest["packageFiles"]:
    if entry["path"] == sys.argv[2]:
        print(entry["sha256"])
        raise SystemExit(0)
raise SystemExit("Manifest file not found: " + sys.argv[2])
PY
}

sha256_file() {
  /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'
}

assert_fixed_boundaries() {
  [[ "$SERVICE_ROOT" == "/Users/work/Services/job-search-agent" ]] \
    || die "Unexpected service root."
  [[ -x "$NODE" ]] || die "Pinned Node runtime is missing."
  [[ -x "$VINEXT" ]] || die "Existing Vinext runtime is missing."
  [[ -f "$PLIST" ]] || die "Installed frontend LaunchAgent is missing."
  [[ -d "$SERVICE_ROOT/dist" ]] || die "Current frontend dist is missing."
  [[ -d "$INCOMING_ROOT" ]] || die "Incoming release directory is missing."
  [[ -n "$RELEASE_DIR" && -d "$RELEASE_DIR" ]] \
    || die "Release directory is missing."
  RELEASE_DIR="$(canonical_path "$RELEASE_DIR")"
  case "$RELEASE_DIR" in
    "$INCOMING_ROOT"/*) ;;
    *) die "Release must be extracted below $INCOMING_ROOT." ;;
  esac
  [[ -f "$RELEASE_DIR/release-manifest.json" ]] \
    || die "Release manifest is missing."
}

wait_for_frontend() {
  local port="$1"
  for _ in {1..60}; do
    if /usr/bin/curl --silent --fail --max-time 3 \
      "http://127.0.0.1:$port/api/system/status" >/dev/null 2>&1
    then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

validate_frontend() {
  local port="$1"
  local validate_market_report="${2:-true}"
  local temporary
  temporary="$(mktemp -d "$LOG_ROOT/main-beta-smoke.XXXXXX")"
  local status_file="$temporary/system-status.json"
  local search_file="$temporary/search.json"
  local decision_file="$temporary/decision.json"
  local market_report_file="$temporary/market-report.json"
  local progress_file="$temporary/progress.html"
  local workspace_file="$temporary/workspace.json"
  local decision_status="$temporary/decision-status.txt"
  local market_report_status="$temporary/market-report-status.txt"
  local workspace_status="$temporary/workspace-status.txt"
  local result=0

  for route in "/" "/v2" "/progress" "/api/system/status"; do
    /usr/bin/curl --silent --show-error --fail --max-time 12 \
      "http://127.0.0.1:$port$route" >/dev/null || result=$?
  done

  if [[ "$result" == "0" ]]; then
    /usr/bin/curl --silent --show-error --fail --max-time 12 \
      "http://127.0.0.1:$port/api/system/status" >"$status_file" \
      || result=$?
  fi
  if [[ "$result" == "0" ]]; then
    /usr/bin/curl --silent --show-error --fail --max-time 15 \
      --get \
      --data-urlencode "q=电网" \
      --data-urlencode "limit=1" \
      "http://127.0.0.1:$port/api/intelligence/v1/jobs/search" \
      >"$search_file" || result=$?
  fi
  if [[ "$result" == "0" ]]; then
    /usr/bin/curl --silent --show-error --max-time 20 \
      --output "$decision_file" \
      --write-out "%{http_code}" \
      --header "Content-Type: application/json" \
      --data-binary \
      '{"jobId":"63381","profile":{"degreeLevel":"bachelor","major":"计算机科学与技术","graduationYear":2027,"schoolName":null}}' \
      "http://127.0.0.1:$port/api/intelligence/v1/decisions/evaluate" \
      >"$decision_status" || result=$?
  fi
  if [[ "$result" == "0" && "$validate_market_report" == "true" ]]; then
    /usr/bin/curl --silent --show-error --max-time 45 \
      --output "$market_report_file" \
      --write-out "%{http_code}" \
      --header "Content-Type: application/json" \
      --data-binary \
      '{"profile":{"degreeLevel":"bachelor","major":"电气工程及其自动化","graduationYear":2028,"preferredCities":"全国","availableHoursPerWeek":10,"capabilityLevels":{"resume":"missing","application":"missing","interview":"missing","project_evidence":"missing","internship":"missing","competition":"missing"}}}' \
      "http://127.0.0.1:$port/api/market-report" \
      >"$market_report_status" || result=$?
  else
    printf '{}\n' >"$market_report_file"
    printf 'skipped\n' >"$market_report_status"
  fi
  if [[ "$result" == "0" ]]; then
    /usr/bin/curl --silent --show-error --fail --max-time 12 \
      "http://127.0.0.1:$port/progress" >"$progress_file" || result=$?
  fi
  if [[ "$result" == "0" ]]; then
    /usr/bin/curl --silent --show-error --max-time 12 \
      --output "$workspace_file" \
      --write-out "%{http_code}" \
      "http://127.0.0.1:$port/api/workspace" \
      >"$workspace_status" || result=$?
  fi

  if [[ "$result" == "0" ]]; then
    /usr/bin/python3 - \
      "$status_file" \
      "$search_file" \
      "$decision_file" \
      "$decision_status" \
      "$market_report_file" \
      "$market_report_status" \
      "$progress_file" \
      "$workspace_file" \
      "$workspace_status" \
      "$validate_market_report" <<'PY' || result=$?
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    status = json.load(handle)
with open(sys.argv[2], "r", encoding="utf-8") as handle:
    search = json.load(handle)
with open(sys.argv[3], "r", encoding="utf-8") as handle:
    decision = json.load(handle)
with open(sys.argv[4], "r", encoding="utf-8") as handle:
    decision_status = handle.read().strip()
with open(sys.argv[5], "r", encoding="utf-8") as handle:
    market_report = json.load(handle)
with open(sys.argv[6], "r", encoding="utf-8") as handle:
    market_report_status = handle.read().strip()
with open(sys.argv[7], "r", encoding="utf-8") as handle:
    progress = handle.read()
with open(sys.argv[8], "r", encoding="utf-8") as handle:
    workspace = json.load(handle)
with open(sys.argv[9], "r", encoding="utf-8") as handle:
    workspace_status = handle.read().strip()
market_report_required = sys.argv[10] == "true"

privacy = decision.get("privacy") or {}
market_source = market_report.get("source") or {}
decision_model = market_report.get("decisionModel") or {}
decision_boundary = decision_model.get("boundary") or {}
market_metrics = market_report.get("metrics") or {}
decision_candidates = decision_model.get("candidates") or []
decision_by_id = {
    str(candidate.get("candidateId") or ""): candidate
    for candidate in decision_candidates
}
portfolio = decision_model.get("portfolio") or {}
active_portfolio_ids = [
    str(candidate_id)
    for tier in ("primary", "steady", "sprint")
    for candidate_id in (portfolio.get(tier) or [])
]
primary_portfolio_ids = [
    str(candidate_id)
    for candidate_id in (portfolio.get("primary") or [])
]
workspace_serialized = json.dumps(workspace, ensure_ascii=False)
checks = {
    "intelligenceLive": status.get("intelligenceLive") is True,
    "searchHasJob": len(search.get("items") or []) > 0,
    "decisionHttp200": decision_status == "200",
    "profileNotPersisted": privacy.get("profilePersisted") is False,
    "profileNotLogged": privacy.get("profileLogged") is False,
    "directIdentifiersRejected": privacy.get("directIdentifiersAccepted") is False,
    "marketReportHttp200": (
        not market_report_required or market_report_status == "200"
    ),
    "marketReportUsesMainSiteReadonly": (
        not market_report_required
        or (
            market_source.get("queryMode") == "main-site-decision"
            and decision_boundary.get("candidateSource") == "zhida-main-site-readonly"
        )
    ),
    "decisionModelV2": (
        not market_report_required
        or decision_model.get("version") == "2026-07-22.v2"
    ),
    "decisionPortfolioUsesEvidenceRules": (
        not market_report_required
        or decision_boundary.get("portfolioAuthority") == "deterministic-evidence-rules"
    ),
    "decisionAiCannotOverrideGates": (
        not market_report_required
        or decision_boundary.get("aiRole") == "explain-extract-never-override-gates"
    ),
    "decisionScoreNotProbability": (
        not market_report_required
        or decision_boundary.get("scoreMeaning") == "ranking-not-probability"
    ),
    "marketReportContainsNoStudentPii": (
        not market_report_required
        or (
            decision_boundary.get("containsStudentPii") is False
            and "profile" not in market_report
        )
    ),
    "marketReportHasLiveCandidates": (
        not market_report_required
        or (
            int(market_metrics.get("relevantTotal") or 0) > 0
            and len(decision_candidates) > 0
        )
    ),
    "expiredCandidatesExcludedFromActivePortfolio": (
        not market_report_required
        or all(
            (decision_by_id.get(candidate_id) or {}).get("qualificationStatus")
            != "expired"
            for candidate_id in active_portfolio_ids
        )
    ),
    "primaryPortfolioContainsNoExpiredOrHighRiskCandidate": (
        not market_report_required
        or all(
            (decision_by_id.get(candidate_id) or {}).get("qualificationStatus")
            not in {"expired", "high-risk"}
            for candidate_id in primary_portfolio_ids
        )
    ),
    "progressReleaseMarker": "主前端安全发布包" in progress,
    "anonymousWorkspaceClosed": (
        workspace_status in {"401", "503"}
        and workspace.get("connected") is False
    ),
    "workspaceSubjectNotExposed": "workspaceSubject" not in workspace_serialized,
    "profileNotInWorkspaceResponse": "profile" not in workspace,
}
failed = [name for name, passed in checks.items() if not passed]
if failed:
    raise SystemExit("Main Beta smoke failed: " + ", ".join(failed))
print(json.dumps({"ok": True, "checks": checks}, ensure_ascii=False))
PY
  fi

  rm -rf "$temporary"
  return "$result"
}

run_candidate_smoke() {
  if /usr/sbin/lsof -nP -iTCP:"$CANDIDATE_PORT" -sTCP:LISTEN \
    >/dev/null 2>&1
  then
    die "Candidate port $CANDIDATE_PORT is already in use."
  fi

  local candidate_log
  candidate_log="$(mktemp "$LOG_ROOT/main-beta-candidate.XXXXXX.log")"
  (
    cd "$RELEASE_DIR"
    if [[ -f "$SERVICE_ROOT/.env.production" ]]; then
      set -a
      # shellcheck disable=SC1091
      source "$SERVICE_ROOT/.env.production"
      set +a
    fi
    export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    export WRANGLER_LOG_PATH="$candidate_log.wrangler"
    exec "$VINEXT" start \
      --hostname 127.0.0.1 \
      --port "$CANDIDATE_PORT"
  ) >"$candidate_log" 2>&1 &
  local candidate_pid=$!
  local result=0

  if ! wait_for_frontend "$CANDIDATE_PORT"; then
    tail -n 100 "$candidate_log" >&2 || true
    result=1
  elif ! validate_frontend "$CANDIDATE_PORT"; then
    result=1
  fi

  kill "$candidate_pid" >/dev/null 2>&1 || true
  wait "$candidate_pid" >/dev/null 2>&1 || true
  rm -f "$candidate_log" "$candidate_log.wrangler"
  return "$result"
}

verify_dependency_lock() {
  local declared_hash
  declared_hash="$(manifest_file_hash package-lock.json)"
  local release_hash
  release_hash="$(sha256_file "$RELEASE_DIR/package-lock.json")"
  local live_hash
  live_hash="$(sha256_file "$SERVICE_ROOT/package-lock.json")"
  [[ "$declared_hash" == "$release_hash" ]] \
    || die "Release package-lock hash does not match its manifest."
  [[ "$release_hash" == "$live_hash" ]] \
    || die "Live node_modules cannot be reused: package-lock differs."
}

run_preflight() {
  assert_fixed_boundaries
  "$NODE" \
    "$RELEASE_DIR/scripts/release/verify-main-beta-release.mjs" \
    "$RELEASE_DIR" >/dev/null

  local release_id
  release_id="$(manifest_value releaseId)"
  [[ "$(basename "$RELEASE_DIR")" == "$release_id" ]] \
    || die "Release directory name does not match manifest."
  [[ "$(manifest_value databaseChanges)" == "False" ]] \
    || die "Database-changing releases are forbidden."
  [[ "$(manifest_value environmentChanges)" == "False" ]] \
    || die "Environment-changing releases are forbidden."
  [[ "$(manifest_value sourceFilesIncluded)" == "False" ]] \
    || die "Source-containing releases are forbidden."
  [[ "$(manifest_value secretsIncluded)" == "False" ]] \
    || die "Secret-containing releases are forbidden."
  verify_dependency_lock
  /usr/bin/curl --silent --fail --max-time 12 \
    "http://127.0.0.1:$PRODUCTION_PORT/api/system/status" >/dev/null \
    || die "Current production frontend is not healthy before preflight."

  run_candidate_smoke
  echo "Preflight passed for $release_id on 127.0.0.1:$CANDIDATE_PORT."
}

stop_service() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$LABEL"
  fi
  for _ in {1..40}; do
    if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_service() {
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
  wait_for_frontend "$PRODUCTION_PORT"
}

rollback_release() {
  local backup_dir="$1"
  echo "Release verification failed; restoring previous frontend dist." >&2
  stop_service || true
  if [[ -d "$SERVICE_ROOT/dist" ]]; then
    mv "$SERVICE_ROOT/dist" \
      "$backup_dir/failed-dist-$(date +%Y%m%d-%H%M%S)"
  fi
  [[ -d "$backup_dir/dist" ]] \
    || die "Rollback backup is missing the previous dist."
  mv "$backup_dir/dist" "$SERVICE_ROOT/dist"
  start_service || die "Rollback frontend did not recover."
  validate_frontend "$PRODUCTION_PORT" false \
    || die "Rollback frontend verification failed."
  echo "Previous frontend dist restored."
}

apply_release() {
  run_preflight
  local release_id
  release_id="$(manifest_value releaseId)"
  [[ "${JOB_SEARCH_AGENT_RELEASE_APPROVED:-}" == "$release_id" ]] \
    || die "Set JOB_SEARCH_AGENT_RELEASE_APPROVED=$release_id to apply."

  local backup_dir
  backup_dir="$BACKUP_ROOT/$release_id-$(date +%Y%m%d-%H%M%S)"
  local staged_dist
  staged_dist="$SERVICE_ROOT/.main-beta-dist-next-$release_id"
  [[ ! -e "$staged_dist" ]] \
    || die "Staged dist already exists: $staged_dist"
  mkdir -p "$backup_dir"
  cp -R "$RELEASE_DIR/dist" "$staged_dist"
  diff -qr "$RELEASE_DIR/dist" "$staged_dist" >/dev/null \
    || die "Staged dist differs from the verified release."

  if ! stop_service; then
    die "Unable to stop the current frontend cleanly."
  fi
  if ! mv "$SERVICE_ROOT/dist" "$backup_dir/dist"; then
    start_service || true
    die "Unable to preserve the current frontend dist."
  fi
  if ! mv "$staged_dist" "$SERVICE_ROOT/dist"; then
    rollback_release "$backup_dir"
    exit 1
  fi
  if ! start_service || ! validate_frontend "$PRODUCTION_PORT" false; then
    rollback_release "$backup_dir"
    exit 1
  fi

  mkdir -p "$RECEIPT_ROOT"
  cp "$RELEASE_DIR/release-manifest.json" \
    "$RECEIPT_ROOT/current-main-beta-release.json"
  chmod 600 "$RECEIPT_ROOT/current-main-beta-release.json"
  echo "Release $release_id is active on 127.0.0.1:$PRODUCTION_PORT."
  echo "Rollback backup retained at $backup_dir."
  echo "Port 3001, databases, Dify, knowledge base and tunnel were untouched."
}

case "$ACTION" in
  preflight) run_preflight ;;
  apply) apply_release ;;
  *)
    echo "Usage: $0 {preflight|apply} <release-directory>" >&2
    exit 2
    ;;
esac

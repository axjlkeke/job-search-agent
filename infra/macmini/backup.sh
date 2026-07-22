#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_command tar
require_command rsync

timestamp="$(date '+%Y%m%d-%H%M%S')"
archive="$BACKUP_DIR/tokensoff-$timestamp.tar.gz"
staging="$(mktemp -d "${TMPDIR:-/tmp}/tokensoff-backup.XXXXXX")"
trap 'rm -rf "$staging"' EXIT

mkdir -p "$BACKUP_DIR" "$staging/kb" "$staging/dify" "$staging/workspaces"

if [[ -d "$KB_DATA_DIR" ]]; then
  rsync -a \
    --exclude "$(basename "$KB_DB_PATH")" \
    --exclude "$(basename "$KB_DB_PATH")-wal" \
    --exclude "$(basename "$KB_DB_PATH")-shm" \
    "$KB_DATA_DIR/" "$staging/kb/"
fi

if [[ -d "$JOB_AGENT_WORKSPACE_DIR" ]]; then
  rsync -a "$JOB_AGENT_WORKSPACE_DIR/" "$staging/workspaces/"
fi

if [[ -f "$KB_DB_PATH" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$KB_DB_PATH" ".backup '$staging/kb/$(basename "$KB_DB_PATH")'"
  else
    warn "系统没有 sqlite3，已跳过知识库数据库备份"
  fi
fi

DIFY_DOCKER_DIR="$DIFY_ROOT_DIR/docker"
if [[ -d "$DIFY_DOCKER_DIR" ]] && docker info >/dev/null 2>&1; then
  if docker_compose \
    --project-directory "$DIFY_DOCKER_DIR" \
    -f "$DIFY_DOCKER_DIR/docker-compose.yaml" \
    ps --status running db_postgres 2>/dev/null | grep -q db_postgres; then
    log "正在导出 Dify PostgreSQL"
    docker_compose \
      --project-directory "$DIFY_DOCKER_DIR" \
      -f "$DIFY_DOCKER_DIR/docker-compose.yaml" \
      exec -T db_postgres \
      pg_dump -U "${DIFY_DB_USER:-postgres}" "${DIFY_DB_NAME:-dify}" \
      >"$staging/dify/postgres.sql"
  else
    warn "Dify 数据库容器未运行，已跳过 PostgreSQL 导出"
  fi
fi

cat >"$staging/README.txt" <<'EOF'
这份备份包含知识库业务数据、Agent 匿名路径状态和可用时的 Dify PostgreSQL 导出。
匿名路径状态只包含公开岗位快照与任务勾选，不包含姓名、学校、专业或主站账号标识。
Qdrant 只是可重建的检索索引，默认不打包。
env.local、Cloudflare 凭据和其他密钥默认不进入备份。
EOF

tar -C "$staging" -czf "$archive" .
chmod 600 "$archive"

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$archive" >"$archive.sha256"
  chmod 600 "$archive.sha256"
fi

find "$BACKUP_DIR" -type f -name 'tokensoff-*.tar.gz*' -mtime "+$BACKUP_RETENTION_DAYS" -delete
log "备份已完成：$archive"

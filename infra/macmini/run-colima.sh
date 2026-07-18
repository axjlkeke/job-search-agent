#!/usr/bin/env bash

set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

if docker info >/dev/null 2>&1; then
  exit 0
fi

exec colima start \
  --cpu "$COLIMA_CPU" \
  --memory "$COLIMA_MEMORY_GB" \
  --disk "$COLIMA_DISK_GB" \
  --vm-type vz \
  --mount-type virtiofs


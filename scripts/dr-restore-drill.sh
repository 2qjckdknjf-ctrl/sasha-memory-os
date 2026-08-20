#!/usr/bin/env bash
# Official M14 Slice 04 bounded DR restore drill harness.
# Usage:
#   MEMORY_OS_DR_RESTORE_PROJECT_ID=44444444-4444-4444-8444-444444444420 \
#   ./scripts/dr-restore-drill.sh
set -euo pipefail
exec npx tsx apps/api/src/restoreDrill.cli.ts "$@"

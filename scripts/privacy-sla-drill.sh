#!/usr/bin/env bash
# Usage:
#   MEMORY_OS_PRIVACY_SLA_PROJECT_ID=44444444-4444-4444-8444-444444444420 \
#   ./scripts/privacy-sla-drill.sh
set -euo pipefail
exec npx tsx apps/api/src/privacySlaDrill.cli.ts "$@"

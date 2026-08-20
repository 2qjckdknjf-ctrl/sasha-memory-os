#!/usr/bin/env bash
# Official M14 Slice 02 bounded API/MCP soak harness.
# Usage:
#   MEMORY_OS_API_BASE_URL=http://localhost:8787 \
#   MEMORY_OS_SOAK_PROJECT_ID=44444444-4444-4444-8444-444444444401 \
#   ./scripts/soak-bounded.sh
set -euo pipefail
exec npx tsx apps/api/src/soakHarness.cli.ts "$@"

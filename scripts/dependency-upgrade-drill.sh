#!/usr/bin/env bash
# Usage:
#   MEMORY_OS_DEPENDENCY_UPGRADE_PROJECT_ID=44444444-4444-4444-8444-444444444420 \
#   ./scripts/dependency-upgrade-drill.sh
set -euo pipefail
exec npx tsx apps/api/src/dependencyUpgradeDrill.cli.ts "$@"

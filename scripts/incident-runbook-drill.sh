#!/usr/bin/env bash
# Official M14 Slice 05 bounded incident runbook drill harness.
# Usage:
#   MEMORY_OS_INCIDENT_RUNBOOK_PROJECT_ID=44444444-4444-4444-8444-444444444420 \
#   ./scripts/incident-runbook-drill.sh
set -euo pipefail
exec npx tsx apps/api/src/incidentRunbookDrill.cli.ts "$@"

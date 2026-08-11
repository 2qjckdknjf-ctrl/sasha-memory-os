#!/usr/bin/env bash
# Deploy hosted worker-ticks Edge function (no Docker; uses Supabase API bundling).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx supabase functions deploy worker-ticks \
  --project-ref "${MEMORY_OS_PROJECT_REF:-vpxblcxsvlylqyldiuwr}" \
  --no-verify-jwt \
  --use-api
echo "Deployed. Health: https://${MEMORY_OS_PROJECT_REF:-vpxblcxsvlylqyldiuwr}.supabase.co/functions/v1/worker-ticks/health"

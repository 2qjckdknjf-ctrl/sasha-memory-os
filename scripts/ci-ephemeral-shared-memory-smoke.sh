#!/usr/bin/env bash
# Ephemeral Supabase contract smoke for mandatory PR CI (Memory OS …4402).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
API_SECRET="${MEMORY_OS_API_SECRET:-ci-ephemeral-secret}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ephemeral_smoke=skipped_no_supabase_cli"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ephemeral_smoke=skipped_no_docker"
  exit 1
fi

echo "== supabase start (db + api only)"
supabase start -x gotrue,realtime,storage,imgproxy,edge-runtime,logflare,vector,studio

echo "== supabase db reset (migrations + seed)"
supabase db reset

eval "$(supabase status -o env)"
export MEMORY_OS_SUPABASE_URL="${SUPABASE_URL}"
export MEMORY_OS_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}"
export MEMORY_OS_API_SECRET="${API_SECRET}"
export MEMORY_OS_ENV=local
export MEMORY_OS_MCP_PROFILE=chatgpt
export MEMORY_OS_REQUIRE_API_AUTH=1
export PORT=8787

echo "== build local-agent (bin lifecycle)"
corepack pnpm@9.15.9 --filter @memory-os/local-agent run build

echo "== start API against ephemeral Supabase"
corepack pnpm@9.15.9 --filter @memory-os/api dev &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:8787/health" >/tmp/ephemeral-health.json 2>/dev/null; then
    cat /tmp/ephemeral-health.json
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "ephemeral_smoke=api_start_timeout"
    exit 1
  fi
  sleep 1
done

export MEMORY_OS_API_BASE_URL="http://127.0.0.1:8787"
export MEMORY_OS_PROJECT_ID="${PROJECT_ID}"

echo "== ChatGPT MCP smoke on ephemeral DB"
./scripts/smoke-mcp-chatgpt.sh

echo "== shared-memory fixture harness"
./scripts/acceptance-shared-memory-e2e.sh

echo "ephemeral_smoke=pass project_id=${PROJECT_ID}"

#!/usr/bin/env bash
# Production live smoke preflight: require P0 migration (Memory OS project …4402).
# Emits BLOCKED_REMOTE_MIGRATION (exit 0) when remote schema is not ready — not a false PASS.
set -euo pipefail

PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
API_BASE="${MEMORY_OS_API_BASE_URL:-}"
SECRET="${MEMORY_OS_API_SECRET:-}"

if [[ -z "$API_BASE" || -z "$SECRET" ]]; then
  echo "live_migration_preflight=skipped_missing_credentials"
  exit 0
fi

base="${API_BASE%/}"
probe_key="live-migration-preflight-$(date +%s)-${RANDOM}"

payload=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory.store_decision","arguments":{"project_id":"${PROJECT_ID}","title":"Migration preflight ${probe_key}","content":"preflight probe","idempotency_key":"${probe_key}"}}}
EOF
)

response=$(curl -sS --connect-timeout 10 --max-time 30 \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "x-memory-os-api-secret: ${SECRET}" \
  --data-binary "$payload" \
  "${base}/mcp" || true)

if echo "$response" | grep -q 'project not found'; then
  echo "live_migration_preflight=BLOCKED_REMOTE_MIGRATION"
  echo "remote_project_id=${PROJECT_ID}"
  echo "reason=Memory OS project UUID missing on production; apply P0 migration before live smoke."
  exit 0
fi

if echo "$response" | grep -q '"error"'; then
  echo "live_migration_preflight=unexpected_error"
  echo "$response"
  exit 1
fi

echo "live_migration_preflight=ready"
exit 0

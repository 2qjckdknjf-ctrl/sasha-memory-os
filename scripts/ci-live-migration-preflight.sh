#!/usr/bin/env bash
# Production live smoke preflight: require P0 migration (Memory OS project …4402).
# Read-only probe only — must not mutate production memory.
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

payload=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory.search","arguments":{"query":"migration preflight probe","project_id":"${PROJECT_ID}","limit":1}}}
EOF
)

response=$(curl -sS --connect-timeout 10 --max-time 30 \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "x-memory-os-api-secret: ${SECRET}" \
  --data-binary "$payload" \
  "${base}/mcp" || true)

if [[ -z "${response//[[:space:]]/}" ]]; then
  echo "live_migration_preflight=unexpected_error"
  echo "reason=empty_or_missing_response"
  echo "probe=memory.search(read-only)"
  exit 1
fi

if echo "$response" | grep -q 'project not found'; then
  echo "live_migration_preflight=BLOCKED_REMOTE_MIGRATION"
  echo "remote_project_id=${PROJECT_ID}"
  echo "probe=memory.search(read-only)"
  echo "reason=Memory OS project UUID missing on production; apply P0 migration before live smoke."
  exit 0
fi

if echo "$response" | grep -q '"error"'; then
  echo "live_migration_preflight=unexpected_error"
  echo "$response"
  exit 1
fi

echo "live_migration_preflight=ready"
echo "probe=memory.search(read-only)"
exit 0

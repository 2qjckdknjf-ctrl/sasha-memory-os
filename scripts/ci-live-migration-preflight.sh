#!/usr/bin/env bash
# Production live smoke preflight: require P0 migration (Memory OS project …4402).
# Read-only probe only — must not mutate production memory.
# Emits allowlisted status tokens only; never logs raw production responses.
set -euo pipefail

PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
API_BASE="${MEMORY_OS_API_BASE_URL:-}"
SECRET="${MEMORY_OS_API_SECRET:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$API_BASE" || -z "$SECRET" ]]; then
  echo "live_migration_preflight=skipped_missing_credentials"
  exit 0
fi

base="${API_BASE%/}"
RESPONSE_FILE="$(mktemp)"
chmod 600 "$RESPONSE_FILE"
cleanup() {
  rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

payload=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memory.search","arguments":{"query":"migration preflight probe","project_id":"${PROJECT_ID}","limit":1}}}
EOF
)

curl_rc=0
{
  set +x
  curl -sS --connect-timeout 10 --max-time 30 \
    -o "$RESPONSE_FILE" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -H "x-memory-os-api-secret: ${SECRET}" \
    --data-binary "$payload" \
    "${base}/mcp"
} || curl_rc=$?

echo "probe=memory.search(read-only)"
echo "remote_project_id=${PROJECT_ID}"

node "${SCRIPT_DIR}/ci-live-migration-preflight-parse.mjs" "$RESPONSE_FILE" "$curl_rc"
exit $?

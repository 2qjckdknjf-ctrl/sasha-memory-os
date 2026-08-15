#!/usr/bin/env bash
# ChatGPT pilot MCP loop (mode A readiness): initialize → tools/list → search → store_decision.
# Usage:
#   MEMORY_OS_API_BASE_URL=http://localhost:8787 ./scripts/smoke-mcp-chatgpt.sh
# Optional: MEMORY_OS_API_SECRET, MEMORY_OS_MCP_PROFILE=chatgpt on the server.
set -euo pipefail
API="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
SECRET_HEADER=()
if [[ -n "${MEMORY_OS_API_SECRET:-}" ]]; then
  SECRET_HEADER=(-H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}")
fi
ACCEPT=(-H 'accept: application/json, text/event-stream' -H 'content-type: application/json')
KEY="smoke-chatgpt-$(date +%s)"

rpc() {
  local id="$1"
  local method="$2"
  local params="${3:-}"
  local payload
  if [[ -z "$params" ]]; then
    params='{}'
  fi
  printf -v payload '{"jsonrpc":"2.0","id":%s,"method":"%s","params":%s}' \
    "$id" "$method" "$params"
  curl -fsS "$API/mcp" \
    "${ACCEPT[@]}" \
    "${SECRET_HEADER[@]}" \
    --data-binary "$payload"
}

echo "== GET $API/mcp/health"
curl -fsS "$API/mcp/health" "${SECRET_HEADER[@]}" | tee /tmp/memory-os-mcp-chatgpt-health.json
echo

echo "== GET $API/mcp (expect 405)"
code=$(curl -sS -o /tmp/memory-os-mcp-chatgpt-get.json -w '%{http_code}' \
  "$API/mcp" "${SECRET_HEADER[@]}" || true)
echo "status=$code"
test "$code" = "405"
echo

echo "== initialize"
rpc 1 initialize '{"protocolVersion":"2025-03-26"}' \
  | tee /tmp/memory-os-mcp-chatgpt-init.json
echo

echo "== tools/list"
rpc 2 tools/list '{}' | tee /tmp/memory-os-mcp-chatgpt-tools.json
echo

echo "== memory.search (defaults fill actor/project)"
rpc 3 tools/call "{\"name\":\"memory.search\",\"arguments\":{\"query\":\"Slice 01\",\"pack_context\":true}}" \
  | tee /tmp/memory-os-mcp-chatgpt-search.json
echo

echo "== memory.store_decision"
rpc 4 tools/call "{\"name\":\"memory.store_decision\",\"arguments\":{\"title\":\"ChatGPT smoke decision\",\"content\":\"Pilot MCP write via streamable HTTP\",\"idempotency_key\":\"${KEY}\"}}" \
  | tee /tmp/memory-os-mcp-chatgpt-decision.json
echo

echo "smoke-mcp-chatgpt ok"

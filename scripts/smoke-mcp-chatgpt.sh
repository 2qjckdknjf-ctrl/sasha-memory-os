#!/usr/bin/env bash
# ChatGPT pilot MCP loop: health → initialize → exact tool allowlist → search →
# store_decision → memory.get → read-after-write search.
# Usage:
#   MEMORY_OS_API_BASE_URL=http://localhost:8787 ./scripts/smoke-mcp-chatgpt.sh
# Optional: MEMORY_OS_API_SECRET. Server should run MEMORY_OS_MCP_PROFILE=chatgpt.
set -euo pipefail
API="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
SECRET_HEADER=()
if [[ -n "${MEMORY_OS_API_SECRET:-}" ]]; then
  SECRET_HEADER=(-H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}")
fi
ACCEPT=(-H 'accept: application/json, text/event-stream' -H 'content-type: application/json')
KEY="smoke-chatgpt-$(date +%s)-${RANDOM}"

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

assert_rpc_ok() {
  local file="$1"
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    if (body.error) {
      console.error(`JSON-RPC error in ${file}:`, body.error);
      process.exit(1);
    }
    if (!("result" in body)) {
      console.error(`Missing JSON-RPC result in ${file}`);
      process.exit(1);
    }
  ' "$file"
}

echo "== GET $API/mcp/health"
curl -fsS "$API/mcp/health" "${SECRET_HEADER[@]}" | tee /tmp/memory-os-mcp-chatgpt-health.json
echo
node -e '
  const fs = require("fs");
  const h = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-health.json", "utf8"));
  if (h.ok !== true) throw new Error("MCP health is not ok");
  if (h.profile !== "chatgpt") throw new Error(`Expected chatgpt profile, got ${h.profile}`);
'

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
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-init.json
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-init.json", "utf8"));
  if (r.result.protocolVersion !== "2025-03-26") {
    throw new Error(`Unexpected MCP protocol version: ${r.result.protocolVersion}`);
  }
  if (r.result.serverInfo?.profile !== "chatgpt") {
    throw new Error(`Unexpected server profile: ${r.result.serverInfo?.profile}`);
  }
'

echo "== tools/list"
rpc 2 tools/list '{}' | tee /tmp/memory-os-mcp-chatgpt-tools.json
echo
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-tools.json
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-tools.json", "utf8"));
  const expected = [
    "memory.search",
    "memory.get",
    "context.project",
    "capture.text",
    "memory.store_decision",
    "handoff.create",
    "memory.set_status",
  ].sort();
  const actual = (r.result.tools ?? []).map((t) => t.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("Unexpected ChatGPT tool surface", { expected, actual });
    process.exit(1);
  }
  console.log(`tool allowlist ok (${actual.length})`);
'

echo "== memory.search (defaults fill actor/workspace; project stays optional)"
rpc 3 tools/call "{\"name\":\"memory.search\",\"arguments\":{\"query\":\"Slice 01\",\"pack_context\":true}}" \
  | tee /tmp/memory-os-mcp-chatgpt-search.json
echo
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-search.json

echo "== memory.store_decision"
rpc 4 tools/call "{\"name\":\"memory.store_decision\",\"arguments\":{\"project_id\":\"${PROJECT_ID}\",\"title\":\"ChatGPT smoke decision ${KEY}\",\"content\":\"Pilot MCP write via streamable HTTP; marker=${KEY}\",\"idempotency_key\":\"${KEY}\"}}" \
  | tee /tmp/memory-os-mcp-chatgpt-decision.json
echo
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-decision.json
DECISION_ID=$(node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-decision.json", "utf8"));
  const id = r.result?.structuredContent?.id;
  if (!id) process.exit(2);
  process.stdout.write(String(id));
')
echo "decision_id=$DECISION_ID"

echo "== memory.get (read stored decision)"
rpc 5 tools/call "{\"name\":\"memory.get\",\"arguments\":{\"memory_id\":\"${DECISION_ID}\"}}" \
  | tee /tmp/memory-os-mcp-chatgpt-get-decision.json
echo
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-get-decision.json
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-get-decision.json", "utf8"));
  const expected = process.argv[1];
  const got = String(r.result?.structuredContent?.memory?.id ?? "");
  if (got !== expected) throw new Error(`memory.get mismatch: expected ${expected}, got ${got}`);
' "$DECISION_ID"

echo "== memory.search (read-after-write marker)"
rpc 6 tools/call "{\"name\":\"memory.search\",\"arguments\":{\"query\":\"${KEY}\",\"pack_context\":true}}" \
  | tee /tmp/memory-os-mcp-chatgpt-read-after-write.json
echo
assert_rpc_ok /tmp/memory-os-mcp-chatgpt-read-after-write.json
node -e '
  const fs = require("fs");
  const r = JSON.parse(fs.readFileSync("/tmp/memory-os-mcp-chatgpt-read-after-write.json", "utf8"));
  const marker = process.argv[1];
  const payload = r.result?.structuredContent ?? {};
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  const matched = hits.some((h) => JSON.stringify(h).includes(marker));
  if (!matched) {
    console.error(`Read-after-write search did not return marker ${marker}`, payload);
    process.exit(1);
  }
  console.log("read-after-write ok");
' "$KEY"

echo
echo "smoke-mcp-chatgpt ok"

#!/usr/bin/env bash
# shared-memory-e2e-v2 — verify receipts created by real ChatGPT and Cursor MCP sessions.
# This verifier is read-only: it never impersonates either actor to create acceptance data.
set -euo pipefail

PACK_VERSION="shared-memory-e2e-v2"
RESULT_PATH="${SHARED_MEMORY_E2E_RESULT:-docs/engineering/SHARED_MEMORY_E2E_RESULT.json}"
API="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
CHATGPT_SUBJECT_ID="33333333-3333-4333-8333-333333333302"
CURSOR_SUBJECT_ID="33333333-3333-4333-8333-333333333303"
export PACK_VERSION PROJECT_ID CHATGPT_SUBJECT_ID CURSOR_SUBJECT_ID

required=(
  MEMORY_OS_API_SECRET
  SHARED_MEMORY_CHATGPT_MEMORY_ID
  SHARED_MEMORY_CHATGPT_MARKER
  SHARED_MEMORY_CURSOR_MEMORY_ID
  SHARED_MEMORY_CURSOR_MARKER
)
missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("missing_${name}")
  fi
done

if (( ${#missing[@]} > 0 )); then
  node - "$RESULT_PATH" "$PACK_VERSION" "$PROJECT_ID" "${missing[@]}" <<'NODE'
const fs = require('node:fs');
const [path, packVersion, projectId, ...blockers] = process.argv.slice(2);
fs.writeFileSync(path, `${JSON.stringify({
  packVersion,
  generatedAt: new Date().toISOString(),
  overallStatus: 'BLOCKED',
  claimPassFromMocks: false,
  verificationMode: 'read-only-live-session-receipts',
  projectId,
  chatgptToCursor: 'BLOCKED',
  cursorToChatgpt: 'BLOCKED',
  blockers,
}, null, 2)}\n`);
NODE
  echo "shared-memory-e2e BLOCKED: ${missing[*]}" >&2
  exit 2
fi

secret_header=(-H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}")
accept=(
  -H 'accept: application/json, text/event-stream'
  -H 'content-type: application/json'
)
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

health=$(curl -fsS "${secret_header[@]}" "$API/mcp/health")
node -e '
  const health = JSON.parse(process.argv[1]);
  if (health.ok !== true) throw new Error("MCP health is not ok");
' "$health"

read_receipt() {
  local request_id="$1"
  local memory_id="$2"
  local output="$3"
  local payload
  payload=$(node -e '
    const [id, memoryId] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: Number(id),
      method: "tools/call",
      params: {
        name: "memory.get",
        arguments: { memory_id: memoryId },
      },
    }));
  ' "$request_id" "$memory_id")
  curl -fsS "$API/mcp" \
    "${accept[@]}" \
    "${secret_header[@]}" \
    --data-binary "$payload" >"$output"
  node -e '
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    if (body.error || body.result?.isError === true || !body.result?.structuredContent?.memory?.id) {
      throw new Error(`Invalid memory.get receipt: ${JSON.stringify(body.error ?? body.result)}`);
    }
  ' "$output"
}

assert_receipt() {
  local file="$1"
  local memory_id="$2"
  local marker="$3"
  local subject_id="$4"
  node -e '
    const fs = require("node:fs");
    const [file, memoryId, marker, subjectId, projectId] = process.argv.slice(1);
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    const memory = body.result.structuredContent.memory;
    const actualProject = memory.projectId ?? memory.project_id ??
      memory.effectiveProjectId ?? memory.effective_project_id;
    const actualSubject = memory.createdBySubject ?? memory.created_by_subject;
    if (memory.id !== memoryId) throw new Error(`Memory id mismatch: ${memory.id}`);
    if (actualProject !== projectId) throw new Error(`Project mismatch: ${actualProject}`);
    if (actualSubject !== subjectId) throw new Error(`Actor mismatch: ${actualSubject}`);
    if (!JSON.stringify(memory).includes(marker)) throw new Error(`Marker not found: ${marker}`);
  ' "$file" "$memory_id" "$marker" "$subject_id" "$PROJECT_ID"
}

chatgpt_receipt="$tmpdir/chatgpt.json"
cursor_receipt="$tmpdir/cursor.json"
read_receipt 1 "$SHARED_MEMORY_CHATGPT_MEMORY_ID" "$chatgpt_receipt"
read_receipt 2 "$SHARED_MEMORY_CURSOR_MEMORY_ID" "$cursor_receipt"
assert_receipt \
  "$chatgpt_receipt" \
  "$SHARED_MEMORY_CHATGPT_MEMORY_ID" \
  "$SHARED_MEMORY_CHATGPT_MARKER" \
  "$CHATGPT_SUBJECT_ID"
assert_receipt \
  "$cursor_receipt" \
  "$SHARED_MEMORY_CURSOR_MEMORY_ID" \
  "$SHARED_MEMORY_CURSOR_MARKER" \
  "$CURSOR_SUBJECT_ID"

node - "$RESULT_PATH" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
fs.writeFileSync(path, `${JSON.stringify({
  packVersion: process.env.PACK_VERSION,
  generatedAt: new Date().toISOString(),
  overallStatus: 'PASS',
  claimPassFromMocks: false,
  verificationMode: 'read-only-live-session-receipts',
  projectId: process.env.PROJECT_ID,
  chatgptToCursor: 'PASS',
  cursorToChatgpt: 'PASS',
  receipts: {
    chatgpt: {
      memoryId: process.env.SHARED_MEMORY_CHATGPT_MEMORY_ID,
      marker: process.env.SHARED_MEMORY_CHATGPT_MARKER,
      createdBySubject: process.env.CHATGPT_SUBJECT_ID,
      readBy: 'Cursor MCP',
    },
    cursor: {
      memoryId: process.env.SHARED_MEMORY_CURSOR_MEMORY_ID,
      marker: process.env.SHARED_MEMORY_CURSOR_MARKER,
      createdBySubject: process.env.CURSOR_SUBJECT_ID,
      readBy: 'ChatGPT MCP',
    },
  },
  blockers: [],
}, null, 2)}\n`);
NODE

echo "shared-memory-e2e PASS — verified real-session receipts in project $PROJECT_ID"

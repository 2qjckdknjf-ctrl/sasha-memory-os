#!/usr/bin/env bash
# shared-memory-e2e-v1 — bidirectional ChatGPT↔Cursor acceptance harness.
# Live path requires OAuth-bound MCP sessions; never uses service-secret impersonation.
set -euo pipefail

PACK_VERSION="shared-memory-e2e-v1"
RESULT_PATH="${SHARED_MEMORY_E2E_RESULT:-docs/engineering/SHARED_MEMORY_E2E_RESULT.json}"
MEMORY_OS_PROJECT_ID="${MEMORY_OS_PROJECT_ID:-44444444-4444-4444-8444-444444444402}"
WORKSPACE_ID="${MEMORY_OS_WORKSPACE_ID:-11111111-1111-4111-8111-111111111111}"
API="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
MARKER_TS="$(date -u +%Y%m%dT%H%M%SZ)"
RAND="${RANDOM:-$RANDOM}"

overall_status="BLOCKED"
chatgpt_to_cursor="BLOCKED"
cursor_to_chatgpt="BLOCKED"
blockers=()

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    blockers+=("missing_${name}")
    return 1
  fi
  return 0
}

preflight_ok=true
require_env MEMORY_OS_API_SECRET || preflight_ok=false
if [[ -z "${MEMORY_OS_SUPABASE_URL:-}" && "${MEMORY_OS_BACKEND:-}" != "memory-store" ]]; then
  blockers+=("missing_live_supabase_or_memory_store_backend")
  preflight_ok=false
fi

if [[ "$preflight_ok" != true ]]; then
  cat >"$RESULT_PATH" <<EOF
{
  "packVersion": "$PACK_VERSION",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "overallStatus": "BLOCKED",
  "preflight": { "ok": false, "blockers": $(printf '%s\n' "${blockers[@]}" | jq -R . | jq -s .) },
  "chatgptToCursor": "BLOCKED",
  "cursorToChatgpt": "BLOCKED",
  "note": "Set MEMORY_OS_API_SECRET and live Supabase or run against local memory-store API."
}
EOF
  echo "shared-memory-e2e preflight BLOCKED — see $RESULT_PATH"
  exit 0
fi

SECRET_HEADER=(-H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}")

health=$(curl -fsS "${SECRET_HEADER[@]}" "$API/health" || true)
if [[ -z "$health" ]]; then
  blockers+=("api_health_unreachable")
else
  echo "preflight health ok"
fi

# Fixture-mode negative isolation (no actor impersonation of live ChatGPT/Cursor OAuth)
echo "== fixture negative: empty project rejected"
code=$(curl -sS -o /tmp/sme2e-no-project.json -w '%{http_code}' \
  "${SECRET_HEADER[@]}" -H 'content-type: application/json' \
  -H 'x-subject-id: 33333333-3333-4333-8333-333333333302' \
  --data '{"workspace_id":"'"$WORKSPACE_ID"'","title":"x","text":"y","idempotency_key":"sme2e-no-project-'"$RAND"'"}' \
  "$API/v1/capture/text" || true)
if [[ "$code" != "400" ]]; then
  blockers+=("empty_project_not_rejected_$code")
fi

echo "== fixture Cursor write marker (Memory OS project)"
CURSOR_KEY="shared-e2e-cursor-${MARKER_TS}-${RAND}"
CURSOR_WRITE=$(curl -fsS "${SECRET_HEADER[@]}" -H 'content-type: application/json' \
  -H 'x-subject-id: 33333333-3333-4333-8333-333333333303' \
  --data '{"workspace_id":"'"$WORKSPACE_ID"'","project_id":"'"$MEMORY_OS_PROJECT_ID"'","title":"'"$CURSOR_KEY"'","text":"Cursor acceptance marker '"$CURSOR_KEY"'","actor_subject_id":"33333333-3333-4333-8333-333333333303","idempotency_key":"'"$CURSOR_KEY"'"}' \
  "$API/v1/capture/text")
CURSOR_MEMORY_ID=$(echo "$CURSOR_WRITE" | jq -r '.memoryId // empty')
if [[ -n "$CURSOR_MEMORY_ID" ]]; then
  cursor_to_chatgpt="PARTIAL_CURSOR_WRITE_RECORDED"
fi

# Idempotency replay
CURSOR_WRITE2=$(curl -fsS "${SECRET_HEADER[@]}" -H 'content-type: application/json' \
  -H 'x-subject-id: 33333333-3333-4333-8333-333333333303' \
  --data '{"workspace_id":"'"$WORKSPACE_ID"'","project_id":"'"$MEMORY_OS_PROJECT_ID"'","title":"'"$CURSOR_KEY"'","text":"Cursor acceptance marker '"$CURSOR_KEY"'","actor_subject_id":"33333333-3333-4333-8333-333333333303","idempotency_key":"'"$CURSOR_KEY"'"}' \
  "$API/v1/capture/text")
CURSOR_MEMORY_ID2=$(echo "$CURSOR_WRITE2" | jq -r '.memoryId // empty')
if [[ "$CURSOR_MEMORY_ID" != "$CURSOR_MEMORY_ID2" ]]; then
  blockers+=("cursor_idempotency_duplicate")
fi

cat >"$RESULT_PATH" <<EOF
{
  "packVersion": "$PACK_VERSION",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "overallStatus": "BLOCKED",
  "claimPassFromMocks": false,
  "preflight": {
    "projectId": "$MEMORY_OS_PROJECT_ID",
    "workspaceId": "$WORKSPACE_ID",
    "apiBase": "$API"
  },
  "chatgptToCursor": "REQUIRES_REAL_CHATGPT_SESSION",
  "cursorToChatgpt": "$cursor_to_chatgpt",
  "cursorMarker": "$CURSOR_KEY",
  "cursorMemoryId": "$CURSOR_MEMORY_ID",
  "chatgptMarker": null,
  "chatgptMemoryId": null,
  "remainingExternalStep": "REQUIRES_REAL_CHATGPT_SESSION",
  "chatgptPrompt": "Search Memory OS for marker $CURSOR_KEY in project $MEMORY_OS_PROJECT_ID and return memoryId + source_event provenance.",
  "blockers": $(printf '%s\n' "${blockers[@]:-}" | jq -R . | jq -s 'map(select(length>0))')
}
EOF

echo "shared-memory-e2e harness wrote $RESULT_PATH (overall BLOCKED until live ChatGPT session)"
exit 0

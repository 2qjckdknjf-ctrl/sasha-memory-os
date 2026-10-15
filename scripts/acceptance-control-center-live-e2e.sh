#!/usr/bin/env bash
set -euo pipefail

required=(
  MEMORY_OS_SUPABASE_URL
  MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY
  MEMORY_OS_API_SECRET
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "control_center_live_e2e=BLOCKED_CREDENTIALS missing=${name}" >&2
    exit 1
  fi
done

workspace_id="${MEMORY_OS_WORKSPACE_ID:-11111111-1111-4111-8111-111111111111}"
owner_id="${MEMORY_OS_OWNER_SUBJECT_ID:-33333333-3333-4333-8333-333333333301}"
cursor_id="${MEMORY_OS_CURSOR_SUBJECT_ID:-33333333-3333-4333-8333-333333333303}"
api_port=8787
web_port=5175
task_tmp="$(mktemp -d)"
api_pid=""
web_pid=""

cleanup() {
  if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null || true; fi
  wait "$web_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
  rm -rf "$task_tmp"
}
trap cleanup EXIT

export MEMORY_OS_ENV=production
export PORT="$api_port"
export MEMORY_OS_CORS_ORIGINS="http://127.0.0.1:${web_port},http://localhost:${web_port}"

pnpm --filter @memory-os/api start >"$task_tmp/api.log" 2>&1 &
api_pid=$!

for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${api_port}/health" >"$task_tmp/health.json"; then
    break
  fi
  sleep 1
done
jq -e '.backend == "supabase"' "$task_tmp/health.json" >/dev/null

owner_headers=(
  -H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}"
  -H "x-subject-id: ${owner_id}"
  -H "x-actor-key: owner"
)

owner_status=$(curl -sS -o "$task_tmp/overview.json" -w '%{http_code}' \
  "${owner_headers[@]}" \
  "http://127.0.0.1:${api_port}/v1/governance/overview?workspace_id=${workspace_id}")
test "$owner_status" = "200"
jq -e '
  .backend == "supabase" and
  (.freshness.status | IN("fresh", "stale", "unknown")) and
  (.jobs.deadLetter | type == "number") and
  (.connections.needsAttention | type == "number")
' "$task_tmp/overview.json" >/dev/null

cursor_status=$(curl -sS -o "$task_tmp/cursor.json" -w '%{http_code}' \
  -H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}" \
  -H "x-subject-id: ${cursor_id}" \
  -H 'x-actor-key: cursor' \
  "http://127.0.0.1:${api_port}/v1/governance/overview?workspace_id=${workspace_id}")
test "$cursor_status" = "403"
jq -e '.error == "forbidden"' "$task_tmp/cursor.json" >/dev/null

unauth_status=$(curl -sS -o "$task_tmp/unauth.json" -w '%{http_code}' \
  -H "x-subject-id: ${owner_id}" \
  -H 'x-actor-key: owner' \
  "http://127.0.0.1:${api_port}/v1/governance/overview?workspace_id=${workspace_id}")
test "$unauth_status" = "401"

jobs_status=$(curl -sS -o "$task_tmp/jobs.json" -w '%{http_code}' \
  "${owner_headers[@]}" \
  "http://127.0.0.1:${api_port}/v1/jobs?workspace_id=${workspace_id}&statuses=queued,running,failed,dead_letter&limit=50")
test "$jobs_status" = "200"
jq -e '
  (.jobs | type == "array") and
  (.jobs | length <= 50) and
  (tostring | contains("idempotencyKey") | not) and
  (tostring | contains("payload") | not)
' "$task_tmp/jobs.json" >/dev/null

unset VITE_MEMORY_API_SECRET
VITE_MEMORY_API_URL='' \
MEMORY_OS_WEB_API_PROXY_TARGET="http://127.0.0.1:${api_port}" \
MEMORY_OS_WEB_API_PROXY_SECRET="$MEMORY_OS_API_SECRET" \
pnpm --filter @memory-os/web exec vite --host 127.0.0.1 --port "$web_port" \
  >"$task_tmp/web.log" 2>&1 &
web_pid=$!

for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:${web_port}/governance" >/dev/null; then
    break
  fi
  sleep 1
done

chrome_bin=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    chrome_bin="$candidate"
    break
  fi
done
if [[ -z "$chrome_bin" ]]; then
  echo 'control_center_live_e2e=BLOCKED_BROWSER' >&2
  exit 1
fi

"$chrome_bin" \
  --headless=new \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-sandbox \
  --user-data-dir="$task_tmp/chrome-profile" \
  --virtual-time-budget=12000 \
  --dump-dom \
  "http://127.0.0.1:${web_port}/governance" >"$task_tmp/governance.html"

grep -q 'Память подключена' "$task_tmp/governance.html"
grep -q 'Обзор здоровья и свежести' "$task_tmp/governance.html"
grep -q 'Failed / dead-letter' "$task_tmp/governance.html"
grep -q 'Outbox pending' "$task_tmp/governance.html"
if grep -q 'Production-метрики не загружены' "$task_tmp/governance.html"; then
  echo 'control_center_live_e2e=FAILED_OVERVIEW_NOT_RENDERED' >&2
  exit 1
fi
if grep -q 'Локальный preview' "$task_tmp/governance.html"; then
  echo 'control_center_live_e2e=FAILED_LOCAL_FALLBACK' >&2
  exit 1
fi

echo 'control_center_live_e2e=PASS'

#!/usr/bin/env bash
# Quick local/prod smoke: health + me + outbox (owner ops need secret outside local).
set -euo pipefail
API="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
SUBJECT="${MEMORY_OS_OWNER_SUBJECT_ID:-33333333-3333-4333-8333-333333333301}"
SECRET_HEADER=()
if [[ -n "${MEMORY_OS_API_SECRET:-}" ]]; then
  SECRET_HEADER=(-H "x-memory-os-api-secret: ${MEMORY_OS_API_SECRET}")
fi

echo "== GET $API/health"
curl -fsS "$API/health" | tee /tmp/memory-os-health.json
echo
echo "== GET $API/v1/me"
curl -fsS "$API/v1/me" \
  -H "x-subject-id: $SUBJECT" \
  -H "x-actor-key: owner" \
  | tee /tmp/memory-os-me.json
echo
echo "== GET $API/v1/outbox/pending"
curl -fsS "$API/v1/outbox/pending?limit=5" \
  -H "x-subject-id: $SUBJECT" \
  -H "x-actor-key: owner" \
  "${SECRET_HEADER[@]}" \
  | tee /tmp/memory-os-outbox.json
echo
echo "smoke ok"

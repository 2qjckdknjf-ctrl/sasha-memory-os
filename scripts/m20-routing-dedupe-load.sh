#!/usr/bin/env bash
set -euo pipefail

: "${DB_URL:?DB_URL is required}"

api_secret="${MEMORY_OS_API_SECRET:-ci-ephemeral-secret}"
workspace_id='11111111-1111-4111-8111-111111111111'
owner_id='33333333-3333-4333-8333-333333333301'
project_id='44444444-4444-4444-8444-444444444402'
other_project_id='44444444-4444-4444-8444-444444444401'
idempotency_key='m20-s03-routing-dedupe-load'
result_dir="$(mktemp -d)"

cleanup() {
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
    -v workspace_id="$workspace_id" \
    -v idempotency_key="$idempotency_key" \
    >/dev/null 2>&1 <<'SQL' || true
WITH target AS (
  SELECT id FROM source_events
  WHERE workspace_id = :'workspace_id'::uuid
    AND provider = 'manual'
    AND idempotency_key = :'idempotency_key'
)
DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id FROM target);
DELETE FROM processing_jobs
WHERE workspace_id = :'workspace_id'::uuid
  AND job_type = 'ingest'
  AND idempotency_key = :'idempotency_key';
DELETE FROM artifacts WHERE source_event_id IN (
  SELECT id FROM source_events
  WHERE workspace_id = :'workspace_id'::uuid
    AND provider = 'manual'
    AND idempotency_key = :'idempotency_key'
);
DELETE FROM source_events
WHERE workspace_id = :'workspace_id'::uuid
  AND provider = 'manual'
  AND idempotency_key = :'idempotency_key';
SQL
  rm -rf "$result_dir"
}
trap cleanup EXIT

capture_once() {
  local output_file="$1"
  psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -v api_secret="$api_secret" \
    -v owner_id="$owner_id" \
    -v workspace_id="$workspace_id" \
    -v project_id="$project_id" \
    -v idempotency_key="$idempotency_key" \
    >"$output_file" <<'SQL'
SELECT public.api_capture_text(
  :'api_secret', :'owner_id'::uuid, :'workspace_id'::uuid,
  (
    SELECT (resolved->>'projectId')::uuid
    FROM (
      SELECT app.api_resolve_project_ref(
        :'api_secret', :'owner_id'::uuid, :'workspace_id'::uuid, :'project_id'
      ) AS resolved
    ) route
    WHERE (resolved->>'matchCount')::integer = 1
  ),
  'M20 routing dedupe load fixture', 'M20 routing dedupe load fixture body',
  :'idempotency_key', 'internal', false, NULL, 'text/plain'
);
SQL
}

pids=()
for worker in $(seq 1 16); do
  capture_once "$result_dir/$worker.json" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done

unique_receipts="$(jq -r '[.eventId,.artifactId,.jobId] | join("|")' "$result_dir"/*.json | sort -u | wc -l | tr -d ' ')"
if [[ "$unique_receipts" != '1' ]]; then
  echo "m20_routing_dedupe_load=failed receipt_variants=$unique_receipts" >&2
  exit 1
fi

set +e
psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -v api_secret="$api_secret" \
  -v owner_id="$owner_id" \
  -v workspace_id="$workspace_id" \
  -v project_id="$other_project_id" \
  -v idempotency_key="$idempotency_key" \
  >/dev/null 2>&1 <<'SQL'
SELECT public.api_capture_text(
  :'api_secret', :'owner_id'::uuid, :'workspace_id'::uuid, :'project_id'::uuid,
  'M20 routing dedupe load fixture', 'M20 routing dedupe load fixture body',
  :'idempotency_key', 'internal', false, NULL, 'text/plain'
);
SQL
conflict_rc=$?
set -e
if [[ "$conflict_rc" -eq 0 ]]; then
  echo 'm20_routing_dedupe_load=failed cross_project_replay_accepted=true' >&2
  exit 1
fi

psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -f tests/security/m20_performance_routing_dedupe_cases.sql
echo 'm20_routing_dedupe_load=pass concurrent_calls=16 receipt_variants=1 cross_project_replay=rejected payload_logged=false'

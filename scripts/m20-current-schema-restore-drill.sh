#!/usr/bin/env bash
# Disposable logical restore of the current Memory OS public/app/vault schemas.
# The dump never leaves the runner and is deleted even when the drill fails.
set -euo pipefail

: "${DB_URL:?DB_URL is required}"

for command in pg_dump pg_restore psql createdb dropdb; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "m20_restore_drill=missing_command command=$command" >&2
    exit 1
  }
done

task_tmp="$(mktemp -d)"
target_db="m20_restore_${RANDOM}_${RANDOM}"
target_url="${DB_URL%/*}/${target_db}"
started_at="$(date +%s)"

cleanup() {
  dropdb --if-exists --force --maintenance-db="$DB_URL" "$target_db" >/dev/null 2>&1 || true
  rm -rf "$task_tmp"
}
trap cleanup EXIT
chmod 700 "$task_tmp"

inventory_sql="select jsonb_build_object(
  'publicTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
  'rlsTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity),
  'apiFunctions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,4)='api_'),
  'memoryRecords', (select count(*) from public.memory_records),
  'memoryEvidence', (select count(*) from public.memory_evidence),
  'artifacts', (select count(*) from public.artifacts),
  'processingJobs', (select count(*) from public.processing_jobs),
  'outboxEvents', (select count(*) from public.outbox_events),
  'memoryIdChecksum', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.memory_records),
  'evidenceIdChecksum', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.memory_evidence)
)::text;"

source_inventory="$(psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$inventory_sql")"

umask 077
pg_dump "$DB_URL" \
  --format=custom \
  --no-owner \
  --schema=public \
  --schema=app \
  --schema=vault \
  --file="$task_tmp/current.dump"

createdb --maintenance-db="$DB_URL" --template=template0 "$target_db"

# The standard public schema already exists in template0. Exclude only its
# schema-creation TOC row; all tables, functions, policies, grants, and data
# remain in the restore list.
pg_restore --list "$task_tmp/current.dump" > "$task_tmp/restore.list"
awk '!/ SCHEMA - public /' "$task_tmp/restore.list" > "$task_tmp/restore.filtered.list"

pg_restore \
  --exit-on-error \
  --no-owner \
  --use-list="$task_tmp/restore.filtered.list" \
  --dbname="$target_url" \
  "$task_tmp/current.dump"

target_inventory="$(psql "$target_url" -X -A -t -v ON_ERROR_STOP=1 -c "$inventory_sql")"
if [[ "$source_inventory" != "$target_inventory" ]]; then
  echo 'm20_restore_drill=inventory_mismatch' >&2
  exit 1
fi

psql "$target_url" -v ON_ERROR_STOP=1 -f tests/security/m20_security_role_boundary_cases.sql
psql "$target_url" -v ON_ERROR_STOP=1 -f tests/security/m20_reliability_dr_cases.sql

elapsed_seconds="$(( $(date +%s) - started_at ))"
max_rto_seconds="$((8 * 60 * 60))"
if (( elapsed_seconds > max_rto_seconds )); then
  echo "m20_restore_drill=rto_exceeded elapsed_seconds=$elapsed_seconds" >&2
  exit 1
fi

echo "m20_restore_drill=pass elapsed_seconds=$elapsed_seconds rto_target_seconds=$max_rto_seconds payload_logged=false"

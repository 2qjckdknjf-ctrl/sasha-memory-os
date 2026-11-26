#!/usr/bin/env bash
# Disposable logical restore of the current Memory OS public/app/vault schemas.
# The dump never leaves the runner and is deleted even when the drill fails.
set -euo pipefail

: "${DB_URL:?DB_URL is required}"

restore_container="${MEMORY_OS_RESTORE_CONTAINER:-}"
required_commands=(psql createdb dropdb)
if [[ -n "$restore_container" ]]; then
  required_commands+=(docker node)
else
  required_commands+=(pg_dump pg_restore)
fi
for command in "${required_commands[@]}"; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "m20_restore_drill=missing_command command=$command" >&2
    exit 1
  }
done

task_tmp="$(mktemp -d)"
target_db="m20_restore_${RANDOM}_${RANDOM}"
target_url="${DB_URL%/*}/${target_db}"
started_at="$(date +%s)"
container_tmp=""
target_created=false

cleanup() {
  if [[ "$target_created" == true ]]; then
    dropdb --if-exists --force --maintenance-db="$DB_URL" "$target_db" >/dev/null 2>&1 || true
  fi
  if [[ -n "$container_tmp" ]]; then
    docker exec "$restore_container" rm -rf "$container_tmp" >/dev/null 2>&1 || true
  fi
  rm -rf "$task_tmp"
}
trap cleanup EXIT
chmod 700 "$task_tmp"

dump_client=(pg_dump)
restore_client=(pg_restore)
dump_url="$DB_URL"
restore_url="$target_url"
if [[ -n "$restore_container" ]]; then
  # This opt-in mode is only for the disposable local Supabase instance. Running
  # pg_dump/pg_restore in its DB container keeps both clients on the server's
  # major version; a newer pg_restore may emit SET transaction_timeout on PG15.
  dump_url="$(node --input-type=module <<'JS'
try {
  const url = new URL(process.env.DB_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error();
  url.hostname = '127.0.0.1';
  url.port = '5432';
  process.stdout.write(url.href);
} catch {
  console.error('m20_restore_drill=container_requires_local_db_url');
  process.exit(1);
}
JS
)"
  restore_url="${dump_url%/*}/${target_db}"
  dump_client=(docker exec -i "$restore_container" pg_dump)
  restore_client=(docker exec -i "$restore_container" pg_restore)
  "${dump_client[@]}" --version
  "${restore_client[@]}" --version
  container_tmp="$(docker exec "$restore_container" mktemp -d)"
fi

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
  'evidenceIdChecksum', (select md5(coalesce(string_agg(
    memory_id::text || ':' || source_event_id::text,
    ',' order by memory_id, source_event_id
  ), '')) from public.memory_evidence)
)::text;"

source_inventory="$(psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$inventory_sql")"

umask 077
"${dump_client[@]}" "$dump_url" \
  --format=custom \
  --no-owner \
  --schema=public \
  --schema=app \
  --schema=vault \
  --exclude-table-data='vault.secrets' \
  > "$task_tmp/current.dump"

createdb --maintenance-db="$DB_URL" --template=template0 "$target_db"
target_created=true

# Schema-filtered dumps do not include extension definitions or their
# dependencies. Recreate only the extensions used by the Memory OS schemas,
# preserving the source schema for relocatable extensions. Optional
# extensions are selected from the source catalog, so this remains portable
# across local and hosted Supabase profiles.
psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
  WITH required_extensions AS (
    SELECT e.extname, e.extrelocatable, n.nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname IN ('pgcrypto', 'uuid-ossp', 'vector', 'supabase_vault')
  ), statements AS (
    SELECT 1 AS statement_order, nspname AS sort_key,
           format('CREATE SCHEMA IF NOT EXISTS %I;', nspname) AS statement
    FROM required_extensions
    WHERE nspname NOT IN ('pg_catalog', 'public')
    UNION
    SELECT 2, extname,
           format(
             'CREATE EXTENSION IF NOT EXISTS %I%s;',
             extname,
             CASE WHEN extrelocatable THEN format(' WITH SCHEMA %I', nspname) ELSE '' END
           )
    FROM required_extensions
  )
  SELECT statement FROM statements ORDER BY statement_order, sort_key;
" > "$task_tmp/extensions.sql"
psql "$target_url" -X -v ON_ERROR_STOP=1 -f "$task_tmp/extensions.sql"

# The standard public schema exists in template0 and Supabase Vault owns the
# vault schema. Supabase also owns platform-level default ACLs that an ordinary
# database owner cannot impersonate during a logical restore; extension/bootstrap
# provisioning recreates those defaults. Exclude only those platform-owned TOC
# rows. All Memory OS object ACLs, tables, functions, policies, and data remain.
"${restore_client[@]}" --list < "$task_tmp/current.dump" > "$task_tmp/restore.list"
awk '
  !/ SCHEMA - (public|vault) / &&
  !/ DEFAULT ACL .* supabase_admin$/
' "$task_tmp/restore.list" > "$task_tmp/restore.filtered.list"

restore_list="$task_tmp/restore.filtered.list"
if [[ -n "$restore_container" ]]; then
  docker exec -i "$restore_container" sh -c 'umask 077; cat > "$1"' \
    sh "$container_tmp/restore.list" < "$restore_list"
  restore_list="$container_tmp/restore.list"
fi

"${restore_client[@]}" \
  --exit-on-error \
  --no-owner \
  --use-list="$restore_list" \
  --dbname="$restore_url" \
  < "$task_tmp/current.dump"

target_inventory="$(psql "$target_url" -X -A -t -v ON_ERROR_STOP=1 -c "$inventory_sql")"
if [[ "$source_inventory" != "$target_inventory" ]]; then
  echo 'm20_restore_drill=inventory_mismatch' >&2
  exit 1
fi

psql "$target_url" -v ON_ERROR_STOP=1 -f tests/security/m20_security_role_boundary_cases.sql
DB_URL="$target_url" ./scripts/m20-run-reliability-dr-cases.sh

# Vault owns and protects its encrypted secret table, so logical drills never
# copy secret material between databases. Prove the restored extension and app
# wrappers instead with a transient secret that is rolled back and never
# printed.
psql "$target_url" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DO $$
DECLARE
  v_api_secret text;
  v_ref constant text := 'm20/restore-drill/transient';
  v_result jsonb;
BEGIN
  SELECT value INTO v_api_secret
  FROM app.runtime_config
  WHERE key = 'api_secret';

  v_result := app.api_vault_kms_put(
    v_api_secret, v_ref, 'm20-transient-restore-proof'
  );
  IF coalesce((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'restored vault write boundary failed';
  END IF;

  v_result := app.api_vault_kms_get(v_api_secret, v_ref);
  IF coalesce((v_result->>'found')::boolean, false) IS NOT TRUE
     OR v_result->>'plaintext' <> 'm20-transient-restore-proof' THEN
    RAISE EXCEPTION 'restored vault read boundary failed';
  END IF;

  v_result := app.api_vault_kms_delete(v_api_secret, v_ref);
  IF coalesce((v_result->>'deleted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'restored vault delete boundary failed';
  END IF;
END;
$$;
ROLLBACK;
SQL

elapsed_seconds="$(( $(date +%s) - started_at ))"
max_rto_seconds="$((8 * 60 * 60))"
if (( elapsed_seconds > max_rto_seconds )); then
  echo "m20_restore_drill=rto_exceeded elapsed_seconds=$elapsed_seconds" >&2
  exit 1
fi

echo "m20_restore_drill=pass elapsed_seconds=$elapsed_seconds rto_target_seconds=$max_rto_seconds payload_logged=false vault_secret_material_copied=false"

#!/usr/bin/env bash
# Sasha Memory OS — Production migration Phase A (read-only preflight)
# Operator machine: requires supabase login OR SUPABASE_ACCESS_TOKEN
set -euo pipefail

REQUIRED_SHA="d7ee0ba957e0e00709aea142afdc3a76f62fee66"
PROJECT_REF="vpxblcxsvlylqyldiuwr"
EVIDENCE_DIR="${MEMORY_OS_PREFLIGHT_EVIDENCE:-$HOME/.memory-os-production-preflight-evidence}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

log() { echo "[preflight] $*" | tee -a "$EVIDENCE_DIR/phase-a.log"; }

HEAD="$(git rev-parse HEAD)"
if [[ "$HEAD" != "$REQUIRED_SHA" ]]; then
  log "BLOCKED_REPOSITORY_STATE head=$HEAD required=$REQUIRED_SHA"
  exit 2
fi
log "Repository OK head=$HEAD"

for v in SUPABASE_ACCESS_TOKEN MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY MEMORY_OS_SUPABASE_URL \
         MEMORY_OS_API_SECRET MEMORY_OS_PROJECT_REF SUPABASE_DB_PASSWORD; do
  if [[ -n "${!v:-}" ]]; then echo "$v=present"; else echo "$v=missing"; fi
done | tee "$EVIDENCE_DIR/credentials-status.txt"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]] && [[ ! -f "$HOME/.supabase/access-token" ]]; then
  log "BLOCKED_CREDENTIALS"
  exit 3
fi

{
  set +x
  supabase link --project-ref "$PROJECT_REF" ${SUPABASE_DB_PASSWORD:+-p "$SUPABASE_DB_PASSWORD"} --yes
} 2>&1 | tee "$EVIDENCE_DIR/link.log"

supabase migration list --linked --project-ref "$PROJECT_REF" | tee "$EVIDENCE_DIR/migration-list.txt"
supabase backups list --project-ref "$PROJECT_REF" | tee "$EVIDENCE_DIR/backups.txt"

sha256sum \
  supabase/migrations/20260821100000_m15_slice_01_source_event_contract.sql \
  supabase/migrations/20260824100000_p0_project_identity_scope.sql \
  | tee "$EVIDENCE_DIR/pending-checksums.sha256"

INVENTORY_SQL="$EVIDENCE_DIR/pre-apply-inventory.sql"
cat > "$INVENTORY_SQL" <<'SQL'
SELECT 'workspaces' AS k, count(*)::text AS v FROM workspaces;
SELECT 'projects' AS section, id::text, slug, name, status FROM projects ORDER BY slug;
SELECT 'subjects' AS k, count(*)::text AS v FROM subjects;
SELECT 'acl_null_project' AS k, count(*)::text AS v FROM acl_entries WHERE project_id IS NULL;
SELECT 'source_events' AS k, count(*)::text AS v FROM source_events;
SELECT 'memory_records' AS k, count(*)::text AS v FROM memory_records;
SELECT 'mem_by_project' AS section, project_id::text, count(*)::text FROM memory_records GROUP BY project_id;
SELECT 'm15_backfill_candidates' AS k, count(*)::text AS v FROM source_events
  WHERE external_id IS NULL OR external_version IS NULL;
SQL

if supabase db query --help >/dev/null 2>&1; then
  supabase db query --linked --file "$INVENTORY_SQL" 2>&1 | tee "$EVIDENCE_DIR/inventory.txt"
else
  log "supabase db query unavailable — run inventory manually via psql"
fi

log "Evidence: $EVIDENCE_DIR"
log "Verify migration-list: pending ONLY M15 + P0"

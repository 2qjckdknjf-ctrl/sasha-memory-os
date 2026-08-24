#!/usr/bin/env bash
# Sasha Memory OS — Production migration Phase A (read-only preflight)
# Operator machine: requires supabase login OR SUPABASE_ACCESS_TOKEN
set -euo pipefail

M15_CHECKSUM="aa7ac5d042e132caa6bb551b32eb145c7247b237010351a98ae544684ae9dc65"
P0_CHECKSUM="05e9c6d5cd5115acc829b66830024afbec40d9e0e469cc3f67a730855c996935"
PROJECT_REF="vpxblcxsvlylqyldiuwr"
EVIDENCE_DIR="${MEMORY_OS_PREFLIGHT_EVIDENCE:-$HOME/.memory-os-production-preflight-evidence}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

log() { echo "[preflight] $*" | tee -a "$EVIDENCE_DIR/phase-a.log"; }

HEAD="$(git rev-parse HEAD)"
M15_ACTUAL="$(sha256sum supabase/migrations/20260821100000_m15_slice_01_source_event_contract.sql | awk '{print $1}')"
P0_ACTUAL="$(sha256sum supabase/migrations/20260824100000_p0_project_identity_scope.sql | awk '{print $1}')"
if [[ "$M15_ACTUAL" != "$M15_CHECKSUM" || "$P0_ACTUAL" != "$P0_CHECKSUM" ]]; then
  log "BLOCKED_MIGRATION_CHECKSUM_MISMATCH head=$HEAD m15=$M15_ACTUAL p0=$P0_ACTUAL"
  exit 2
fi
log "Repository OK head=$HEAD migration_checksums=ok"

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

if supabase db push --dry-run --linked --project-ref "$PROJECT_REF" 2>&1 | tee "$EVIDENCE_DIR/dry-run.log"; then
  log "dry_run=ok"
else
  log "dry_run=BLOCKED_MIGRATION_HISTORY_DRIFT"
  log "Apply via scripts/apply-remote-migration.sh (Management API), not db push"
fi

INVENTORY_SQL="$ROOT/scripts/production-migration-pre-apply-inventory.sql"
if supabase db query --help >/dev/null 2>&1; then
  supabase db query --linked -f "$INVENTORY_SQL" 2>&1 | tee "$EVIDENCE_DIR/inventory.txt" || true
else
  log "supabase db query unavailable — run inventory manually via psql"
fi

log "Evidence: $EVIDENCE_DIR"
log "Verify migration-list: pending ONLY M15 + P0"
log "Preflight verdict: READY_FOR_OWNER_APPLY_APPROVAL (apply via Management API)"

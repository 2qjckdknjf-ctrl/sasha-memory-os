# M14 Slice 04 - bounded DR / restore drill pack

Status: implementation slice on top of the official M14 SLO pack, bounded soak
recipe, and security-review pack.

## Goal

Ship one additive, versioned DR restore-drill pack plus one bounded local
fixture harness that proves the current stack has two independent backup
contours and that restore validation checks more than row presence.

Official pack version: `m14-s04-v1`

Roadmap sections: `7.5`, `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - `apps/api/src/restoreDrill.ts`
  - `scripts/dr-restore-drill.sh`
  - existing owner export shape `GET /v1/export/memories`
  - existing Privacy-page export path
  - `docs/m0/DATA_CLASSES_AND_RETENTION.md`
  - `docs/adr/ADR-003-storage-modes.md`
  - existing RLS matrix / provenance fields
- Publish one official DR restore-drill pack:
  - pack version `m14-s04-v1`
  - roadmap sections `7.5`, `20.17`
  - defensive-only invariants for bounded, fixture-local recovery checks
- Keep the backup contours explicit and independent:
  - database backup is not the same as archived Storage backup
  - database backup must not claim to restore deleted Storage objects
  - archived Storage objects require a separate versioned off-site copy and
    manifest
  - DB RPO stays `<= 15 min` with PITR, otherwise a daily RPO must be
    documented
  - archived-object RPO stays `<= 24h`
  - private-beta RTO stays `<= 8h`
  - restore drill cadence stays quarterly and before GA
- Keep the drill bounded and local only:
  - fixture/local-only manifests and restore report
  - no hours-long restore
  - no live PITR
  - no Storage pull from production, staging, or any real Supabase project
  - no SQL apply
- Fail closed when restore validation is incomplete:
  - row presence is necessary but not sufficient
  - verify RLS after restore
  - verify archived object checksums
  - verify embedding/index rebuild
  - verify selective provenance reproducibility
  - if owner export evidence is included, require explicit `project_id`
- Keep security invariants unchanged:
  - ChatGPT Mode A stays at exactly 7 tools
  - no owner-token bypass
  - no AISTROYKA fallback
  - no verified-memory writes
  - never log memory bodies, tokens, or export payloads

## Out of scope

- Live production restore
- Live staging restore
- Restore against any real Supabase project
- Incident runbooks as the primary product deliverable
- New support or ops UI
- Export/deletion SLA product work
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New vendors (`k6`, `locust`, or similar)
- SQL migration or production SQL apply
- Exploit PoCs or offensive payloads

## Official checklist

- `db-backup-contour` — database backup contour stays explicit and separate
- `storage-backup-contour` — archived Storage contour stays versioned/off-site
- `rls-after-restore` — restore checks include RLS, not rows only
- `checksum-verify` — restore checks include archived object checksums
- `embedding-index-rebuild` — restore checks include embedding/index rebuild
- `provenance-sample` — restore checks include selective provenance
  reproducibility

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- No live production restore is part of this slice; any production-like restore
  against a real project still requires owner approval.
- The bounded entry point is `scripts/dr-restore-drill.sh`, which delegates to
  the typed local fixture harness in `apps/api/src/restoreDrill.ts`.

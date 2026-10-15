# Data classes, region, retention

Status: **V1 GA policy, refreshed 2026-10-15**. The original owner acceptance
is recorded in [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md);
M20.4 makes the policy executable rather than documentary only.

## Region / residency

| Item | Decision |
|---|---|
| Primary region | `eu-central-1` (Frankfurt), live Supabase project `sasha-memory-os` |
| Scope | One owner workspace with explicit project boundaries |
| EU-only product promise | Not made: optional external AI providers can process data outside the primary region |

## Data map

| Class | Examples | Authoritative storage | Access / deletion behavior |
|---|---|---|---|
| A — Identity / ACL | subjects, memberships, auth binds | Supabase Postgres | Owner/membership controls; not included in project export |
| B — Canonical memory | facts, decisions, tasks, project state, provenance/evidence | `memory_records` and typed/evidence tables | Project ACL; deletion tombstones bodies and removes derived evidence/graph projections |
| C — Capture / quarantine | source events, artifacts, chunks, checksums, storage refs | Supabase Postgres; archived object store only when configured | Exported with provenance; deletion removes chunks and sanitizes payloads/storage refs |
| D — Connector secrets | OAuth access/refresh, cursors | Vault/KMS plus Postgres refs | Service/owner ops only; source revocation removes vault payloads, refs and cursors |
| E — Ops / audit | privacy requests, outbox, jobs, audit | Supabase Postgres | Owner ops; bodies/reasons/tokens are excluded or redacted |
| F — Embeddings / graph | vectors, entities, aliases, edges | Supabase Postgres + pgvector | Same ACL as parent memory; deletion clears vectors and removes graph projection |

Sensitivity labels are `public`, `internal`, `personal`, `confidential`, and
`restricted`. RLS and RPC authorization enforce the effective project and
sensitivity boundary.

## Enforced V1 retention

`POST /v1/privacy/retention/run` is owner-only, requires an explicit project,
and defaults to `dry_run=true`. Policy version: `m20-s04-v1`.

| Data | Retention / action |
|---|---|
| Active / verified memories | Indefinite until owner correction, retraction, or deletion |
| Candidate memories | 90 days, then body/metadata/vector tombstone and derived-record cleanup |
| Quarantine artifacts | 180 days, then chunks, storage refs, checksums, metadata and related source payloads are sanitized |
| Published outbox events | 30 days after `published_at`, then deleted |
| Dead-letter jobs | 90 days after last update, then deleted |
| OAuth vault secrets | Until connection revoke; source-account privacy deletion removes KMS/local vault payloads, refs and cursors |
| Audit log | 365 days; privacy execution also redacts historic snapshots tied to erased objects |
| Raw chat transcripts | Not captured by default; only explicit capture or selected connector scopes |

The apply path records counts and identifiers only. It never copies memory
bodies, source payloads, request reasons, correction text, credentials, or
export payloads into audit/operational telemetry. Project retention deletes
outbox, dead-letter and audit rows only when their source, aggregate, payload or
linked object positively attributes them to the requested project; ambiguous
workspace-level rows are preserved.

## Rights and operational surfaces

- Portability: `GET /v1/export/privacy` returns fully paginated project memories,
  typed decision/task payloads, provenance/evidence, source events,
  artifacts/chunks, connector metadata and the retention policy. It never
  returns connector secrets or vault refs.
- Request: `POST /v1/privacy/requests` creates an idempotent owner request.
- Execution: `POST /v1/privacy/requests/:id/execute` performs correction,
  retraction, memory deletion, or connector-source revocation.
- Retention: `POST /v1/privacy/retention/run` previews or applies the policy.

All four surfaces fail closed without owner authority and explicit project
scope. Database RPCs are executable by `service_role` only.

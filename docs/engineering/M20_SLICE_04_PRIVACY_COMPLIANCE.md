# M20.4 — privacy and compliance operations

Status: implementation complete; production acceptance is required after merge.

Official pack: `m20-s04-v1`

## Delivered surfaces

- `GET /v1/export/privacy`: owner-only, explicit-project portability bundle
  covering canonical/derived memories, provenance/evidence, source events,
  typed decision/task payloads, artifacts/chunks and non-secret connector
  metadata. Routed memories bring their original source, artifact/chunks and
  non-secret connector account into the bundle. Offset pagination reads an
  immutable, owner/project-bound row-wise materialized snapshot identified by
  `exportId` and `snapshotAt`. No whole-project JSON aggregate is built: each
  response aggregates at most the requested page. The snapshot expires after
  15 minutes, is removed after the final page, and an independent per-minute
  database job physically purges abandoned snapshots. The Control Center
  consumes it to completion.
- `POST /v1/privacy/requests`: idempotent correction, retraction, memory deletion
  or connector-source revocation request.
- `POST /v1/privacy/requests/:id/execute`: idempotent execution with a
  metadata-only result.
- `POST /v1/privacy/retention/run`: dry-run by default; apply enforces the
  accepted 30/90/180/365-day windows within the explicit project, including
  project-attributed outbox, dead-letter and audit rows only. A null or future
  `as_of` cutoff fails closed in the database; the API also rejects future
  cutoffs before RPC execution.
- Control Center Privacy UI: full export, target selection, explicit execution,
  and retention preview/apply. Sensitive request text is deliberately absent
  from its operational history.

Migration `20261015230000_m20_privacy_compliance_operations.sql` preserves
tombstones for referential integrity while removing content-bearing evidence,
revisions, chunks, embeddings, graph projections, conflict/personalization
records and typed task/decision payloads. Connector-source deletion additionally
revokes the workspace-wide connection, removes vault references/payloads and
cursors, and erases records derived from that account in every project. A
memory-targeted deletion likewise follows shared source/evidence consumers
across the owner workspace before sanitizing their common provenance. Derived
notifications, job errors and outbox payloads are redacted or stopped before
the underlying source is tombstoned.

## Mandatory acceptance

`tests/security/m20_privacy_compliance_cases.sql`, wired into the ephemeral CI
stack, proves:

1. paginated export includes every primary and derived record plus raw
   provenance, including routed-memory provenance, and remains byte-stable when
   source rows are updated or inserted between page requests;
2. deletion follows multi-generation derivation chains and removes their
   bodies/evidence/graph projections without deleting graph links owned by
   unaffected memories;
3. connector revocation deletes vault/cursor state, stops queued work and
   reaches connector-derived records across project boundaries;
4. execution replay is idempotent;
5. privacy free text never survives in audit/ops state;
6. retention preview is non-mutating; apply expires only quarantined artifacts,
   preserves processed provenance, redacts shared entities that must remain,
   and locks/revalidates candidate memories plus quarantined artifacts before
   destructive mutation; dead-letter jobs and published outbox events are also
   locked/revalidated so replay or delivery cannot race with deletion. Apply
   locks the source-linked jobs first, waits for in-flight ingest, re-scans
   source consumers, stops queued source work, and redacts retention-derived
   notifications/outbox before tombstoning;
7. legacy targetless requests fail closed before mutation, correction audits
   are redacted, authoritative corrections preserve effective project routing,
   retention removes orphan graph entities, arbitrary metadata references do
   not trigger erasure, and operational retention cannot cross the requested
   project boundary;
8. connector deletion resolves canonical and legacy payload account identity
   and stops source-linked capture jobs/outbox before erasure;
9. privacy RPCs are denied to `anon`/`authenticated` and granted to
   `service_role`; transient export snapshots are not directly readable by
   client roles and are owner/workspace/project-bound;
10. future retention cutoffs fail closed without mutation;
11. the scheduled snapshot purge removes abandoned export bodies independently
    of later export traffic.

The TypeScript gate also freezes route names, retention windows, UI hygiene,
schema validation, CI wiring, DPIA/data-map freshness and the exact seven-tool
MCP invariant.

## Production closeout

After merge and green trusted-main CI: apply the migration to the dedicated
Supabase project, exercise export/request/execute/retention-preview against the
canonical project without printing bodies, rerun security/performance advisors,
and store a Memory OS milestone with read-after-write evidence. M20.4 is not
reported live-complete before those checks pass.

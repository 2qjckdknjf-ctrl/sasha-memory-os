# Export, correction, retraction and deletion SLAs

Version: `m20-s04-v1` (supersedes documentary-only `m14-s06-v1`)

All privacy routes are owner-only, require an explicit project, use server-only
database RPCs, and emit metadata-only audit records. Memory/source bodies,
export payloads, free-text reasons, correction text and credentials are never
written to operational logs or rendered in the privacy history.

## Owner export SLA

Owner: Privacy owner
Deadline: 72h from validated owner request
Route: `GET /v1/export/privacy`

The M20.4 route supersedes the narrower legacy `GET /v1/export/memories`
surface. Invocation requires an explicit `project_id`, includes
connector-derived provenance, and writes metadata-only audit counts. Responses
use deterministic offset pagination; the Control Center follows `nextOffset`
until `hasMore=false` and downloads one complete portability bundle.

## Deletion / forget SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

Deletion requires explicit `project_id` and a memory or connector target. The
connector-derived path is executed by `POST /v1/privacy/requests/:id/execute`;
its audit is metadata-only audit and excludes bodies and owner free text.

## Correction SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

Correction requires explicit `project_id`, target memory and correction text.
Execution uses the canonical supersession contract and metadata-only audit.

## Retraction SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

Retraction requires explicit `project_id` and a target memory. Execution marks
the target retracted and emits metadata-only audit.

## Connector-derived coverage

Covered families are GitHub, Google Drive, Gmail, Google Calendar, and Apple transferred objects. The implementation reuses connector lifecycle handling in
`workers/connector-sync/src/index.ts` and the owner-visible transferred-object
surface in `apps/web/src/TransferredObjectsPage.tsx`.

## Telemetry hygiene

Do not log memory bodies, export payloads, privacy request free-text reasons, correction text, or tokens.

Only request/status/scope identifiers and aggregate counts are permitted in
operational audit and telemetry.

| Operation | Route | Target SLA | Executed behavior |
|---|---|---:|---|
| Access/export | `GET /v1/export/privacy` | 72h | Fully paginated project bundle with memory, provenance/evidence, source events, artifacts/chunks and non-secret connector metadata |
| Correction | create request, then `POST /v1/privacy/requests/:id/execute` | 30d | Existing correction contract creates/chooses authoritative memory and supersedes the old record |
| Retraction | same execution route | 30d | Target memory becomes `retracted` |
| Erasure | same execution route | 30d | Target plus derived memories are tombstoned; evidence/revisions/chunks/vectors/graph projection and sensitive snapshots are removed |
| Source revocation | deletion request with `target_connector_account_id` | 30d | Connector is revoked workspace-wide; vault refs/payloads, cursors, pending jobs/outbox and connector-derived records in every project converge to deletion |
| Retention | `POST /v1/privacy/retention/run` | scheduled owner operation | Dry-run by default; apply enforces `m20-s04-v1` windows |

Request creation is idempotent. Reusing a key for a different project, request
type, memory or connector fails closed. Execution is also idempotent: a
completed request returns the saved metadata-only result without repeating the
mutation.

Connector-derived coverage includes GitHub, Google Drive, Gmail, Google
Calendar and Apple transferred objects once their data is present in the
selected project. Revoking an account removes its server-held secret/cursor
state; no provider-side account deletion is claimed.

Retention windows and the complete data map live in
[`docs/m0/DATA_CLASSES_AND_RETENTION.md`](../../m0/DATA_CLASSES_AND_RETENTION.md).
The mandatory transactional acceptance test is
`tests/security/m20_privacy_compliance_cases.sql`.

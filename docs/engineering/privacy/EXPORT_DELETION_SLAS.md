# Export and deletion SLAs

Version: `m14-s06-v1`

Roadmap sections: `16.6`, `16.7`, `20.17`

This note documents the existing privacy/export surfaces only. It does not add a
new product, a new UI, or live production delete/export automation.

## Owner export SLA

Owner: Privacy owner
Deadline: 72h from validated owner request
Route: `GET /v1/export/memories`

- Export stays on the existing owner-only route `GET /v1/export/memories`.
- Export requires explicit `project_id`; never default to AISTROYKA or
  `MEMORY_OS_DEFAULT_PROJECT_ID`.
- The export SLA covers canonical project memories and connector-derived records
  already normalized into project-scoped memories.
- Connector-derived coverage includes GitHub, Google Drive, Gmail, Google Calendar, and Apple transferred objects where those records were captured into the current project scope.
- Audit stays metadata-only audit: record route, project scope, and count only.
  Do not log memory bodies, export payloads, privacy request free-text reasons, correction text, or tokens.

## Deletion / forget SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

- Deletion / forget stays on the existing privacy-request route
  `POST /v1/privacy/requests` with `request_type = deletion`.
- Deletion requires explicit `project_id`; never default to AISTROYKA or
  `MEMORY_OS_DEFAULT_PROJECT_ID`.
- The deletion SLA covers connector-derived data as well as canonical memories.
- Connector-derived coverage includes GitHub, Google Drive, Gmail, Google Calendar, and Apple transferred objects already captured into Memory OS.
- Existing tombstone and retention surfaces remain authoritative; this slice
  does not invent a parallel delete product.
- Audit stays metadata-only audit: request type, target memory id, project
  scope, and status only.

## Correction SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

- Correction stays on the existing privacy-request route
  `POST /v1/privacy/requests` with `request_type = correction`.
- Correction requires explicit `project_id`; never default to AISTROYKA or
  `MEMORY_OS_DEFAULT_PROJECT_ID`.
- Audit stays metadata-only audit and must not quote correction text or memory
  bodies.

## Retraction SLA

Owner: Privacy owner
Deadline: 30d from validated owner request
Route: `POST /v1/privacy/requests`

- Retraction stays on the existing privacy-request route
  `POST /v1/privacy/requests` with `request_type = retraction`.
- Retraction requires explicit `project_id`; never default to AISTROYKA or
  `MEMORY_OS_DEFAULT_PROJECT_ID`.
- Audit stays metadata-only audit and must not quote free-text request reasons
  or payload bodies.

## Connector-derived coverage

- Export/delete coverage for connector-derived data reuses the current shared
  connector surfaces instead of inventing a second privacy stack.
- Covered connector-derived families are GitHub, Google Drive, Gmail, Google Calendar, and Apple transferred objects.
- Shared tombstone execution remains on `workers/connector-sync/src/index.ts`.
- Apple-transferred-object tombstones remain on
  `apps/web/src/TransferredObjectsPage.tsx`.
- Retention defaults stay anchored in `docs/m0/DATA_CLASSES_AND_RETENTION.md`:
  class B canonical memory, class C capture/quarantine artifacts, class D
  connector secrets, class E audit/outbox, and class F embeddings.
- Disconnect/revoke behavior still hands off to the existing connector retention
  and tombstone flows documented in the connector slices.

## Telemetry hygiene

Do not log memory bodies, export payloads, privacy request free-text reasons, correction text, or tokens.

- Export audit entries stay count/scope only.
- Privacy-request audit entries stay request-type/status/scope only.
- Secret values and authorization material stay redacted.
- Live production export/delete is out of scope for this slice and still
  requires owner approval.

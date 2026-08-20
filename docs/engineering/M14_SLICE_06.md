# M14 Slice 06 - export/deletion SLA pack

Status: implementation slice on top of the official M14 SLO, security-review,
DR drill, and incident-runbook packs.

## Goal

Ship one additive, versioned privacy/export-deletion SLA pack plus one bounded
local validator that proves the existing export and privacy-request paths have
checked-in owners, deadlines, connector-derived coverage, explicit project
scope, and metadata-only logging.

Official pack version: `m14-s06-v1`

Roadmap sections: `16.6`, `16.7`, `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - existing owner export `GET /v1/export/memories`
  - existing privacy requests `POST /v1/privacy/requests`
  - `docs/m0/DATA_CLASSES_AND_RETENTION.md`
  - existing connector tombstone/revoke surfaces
  - current Privacy page and export wiring only as a project-scope caller
- Publish one official privacy SLA pack:
  - pack version `m14-s06-v1`
  - roadmap sections `16.6`, `16.7`, `20.17`
  - defensive-only invariants for owner/deadline/project-scope/log hygiene
- Keep export/delete SLAs checked in and fail closed:
  - every SLA path names an owner
  - every SLA path names a deadline
  - export and privacy-request invocation require explicit `project_id`
  - connector-derived coverage is named explicitly
  - correction and retraction stay on the existing privacy-request surface
  - audit/log paths remain metadata-only
  - never fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA
- Keep security invariants unchanged:
  - ChatGPT Mode A stays at exactly 7 tools
  - no owner-token bypass
  - no verified-memory writes
  - never log memory bodies, export payloads, privacy request free-text reasons,
    correction text, or tokens
- Keep the validator bounded and local only:
  - fixture/local-only manifest validation
  - no live export
  - no live delete
  - no production SQL apply

## Out of scope

- Live production export or delete
- Live staging export or delete
- Applying SQL to any real Supabase project
- New support or ops UI
- Dependency-upgrade policy work
- Generic onboarding/documentation outside these SLA notes
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New vendors
- New verified-memory writes

## Official checklist

- `owner-export-sla` - owner export has checked-in owner, deadline, and project scope
- `deletion-forget-sla` - deletion / forget has checked-in owner, deadline, and project scope
- `correction-retraction-sla` - correction and retraction remain covered on the current request path
- `connector-derived-coverage` - connector-derived data is covered on the existing tombstone/export stack
- `no-payload-in-export-logs` - audit/log paths stay metadata-only

## Notes

- No new privacy product is introduced in this slice.
- No new SQL model is required beyond the additive guard migration for the
  existing privacy-request RPC.
- No production SQL apply is part of this work.
- No live production export or delete is part of this slice; any real action
  still requires owner approval.
- The bounded entry point is `scripts/privacy-sla-drill.sh`, which delegates to
  the typed local fixture harness in `apps/api/src/privacySlaDrill.ts`.

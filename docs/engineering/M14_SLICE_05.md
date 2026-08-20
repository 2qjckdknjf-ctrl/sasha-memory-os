# M14 Slice 05 - incident runbook pack

Status: implementation slice on top of the official M14 SLO, security-review,
and DR drill packs.

## Goal

Ship one additive, versioned incident-runbook pack plus one bounded local drill
that proves the current stack has checked-in runbooks for the required alerts
and containment paths before beta.

Official pack version: `m14-s05-v1`

Roadmap sections: `16.4`, `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - `apps/api/src/incidentRunbookDrill.ts`
  - `scripts/incident-runbook-drill.sh`
  - `docs/engineering/SECRETS_POLICY.md`
  - `docs/adr/ADR-005-secrets-and-environments.md`
  - existing connector revoke / replay / resync / retry surfaces
  - existing webhook receiver docs
  - existing `/ops` page only as a pointer to current surfaces
- Publish one official incident-runbook pack:
  - pack version `m14-s05-v1`
  - roadmap sections `16.4`, `20.17`
  - defensive-only invariants for checked-in runbooks and metadata-only alerts
- Keep incident documentation checked in and fail closed:
  - every required runbook names an owner
  - every mapped alert names an owner and a runbook
  - every required playbook includes a rollback/revoke step
  - key rotation and emergency revoke are documented before beta
  - connector revoke must stop jobs/webhooks immediately, then apply retention
  - compromised `service_role` or vault key must rotate, invalidate sessions,
    and audit access logs
  - any write/admin/revoke invocation requires an explicit `project_id`
  - never fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA
- Keep security invariants unchanged:
  - ChatGPT Mode A stays at exactly 7 tools
  - no owner-token bypass
  - no verified-memory writes
  - never log or paste tokens, payloads, memory bodies, or secret values
- Keep the drill bounded and local only:
  - fixture/local-only manifest validation
  - no live revoke
  - no live rollback
  - no production SQL apply

## Out of scope

- Live production revoke or rollback
- Live staging revoke or rollback
- Applying SQL to any real Supabase project
- New support or ops UI
- PagerDuty, Opsgenie, or any new vendor
- Export/deletion SLA product work
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New verified memory writes
- Exploit PoCs or offensive payloads

## Official checklist

- `alert-owner-routing` — every official alert has a checked-in runbook and owner
- `key-rotation` — key rotation is documented as a bounded vault-first path
- `emergency-revoke` — emergency revoke is documented before beta
- `connector-revoke-stop-jobs` — connector revoke stops jobs/webhooks, then retention
- `webhook-dlq-replay-resync` — webhook recovery stays on current replay/resync surfaces
- `service-role-vault-compromise` — service_role/vault compromise rotates, invalidates, audits
- `no-payload-in-alerts` — runbooks stay metadata-only and redact sensitive inputs

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- No live production revoke or rollback is part of this slice; any real action
  still requires owner approval.
- The bounded entry point is `scripts/incident-runbook-drill.sh`, which
  delegates to the typed local fixture harness in
  `apps/api/src/incidentRunbookDrill.ts`.

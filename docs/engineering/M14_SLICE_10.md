# M14 Slice 10 - support / ops surface pack

Status: implementation slice on top of the official M14 Slice 01-09 packs and
the existing Control Center `/ops` page.

## Goal

Ship one additive, versioned, fail-closed support / ops pack that turns the
current Control Center `/ops` page into the official bounded GA support surface
for operators. Reuse existing routes, runbooks, privacy pages, and docs instead
of inventing a new dashboard, pager, connector surface, or live incident
console.

Official pack version: `m14-s10-v1`

Roadmap sections: `20.17`, `RG5 support+ownership`

## In scope

- Reuse the current stack only:
  - `apps/web/src/OpsPage.tsx`
  - official M14 packs in `packages/observability`
  - `docs/engineering/runbooks/`
  - `docs/engineering/ONBOARDING.md`
  - `docs/engineering/M14_DOC_CATALOG.md`
  - `docs/engineering/privacy/EXPORT_DELETION_SLAS.md`
  - existing `/privacy`, `/audit`, and `/connections` pages as links
- Publish one official, versioned support / ops pack:
  - pack version `m14-s10-v1`
  - roadmap sections `20.17` and `RG5 support+ownership`
  - ownership links for SLO/error budgets, runbooks, revoke / rollback,
    export/privacy, and on-call routing
- Keep the pack defensive only and fail closed:
  - ChatGPT Mode A stays exactly 7 tools
  - actor switching on `/ops` stays demo-only
  - explicit `project_id` stays required for write/admin/export paths
  - `MEMORY_OS_DEFAULT_PROJECT_ID` is ignored
  - no AISTROYKA fallback
  - no owner-token bypass
  - no verified-memory writes
  - no tokens, memory bodies, or export payloads in the official ops surface
  - no production SQL apply
  - no live revoke, rollback, restore, or export action from this slice
- Keep the validator bounded and local only:
  - fixture/local-only manifest validation
  - explicit project override required; no canned passing fallback
  - no live write, admin, revoke, rollback, or SQL apply action

## Out of scope

- Applying SQL to any Supabase project
- A new pager product, incident console, or parallel ops application
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New verified-memory writes
- Live revoke, rollback, restore, or export actions
- Token, payload, or exploit examples in docs or validator output
- Production apply implied by `/ops`

## Official checklist

- `reuse-existing-ops-page` - support / ops remains on the current `/ops` page
- `slo-status-findable` - operators can find the official SLO + error-budget pack
- `runbooks-findable` - operators can find checked-in runbooks and ownership
- `revoke-rollback-pointers-findable` - revoke / rollback pointers stay checked in
- `privacy-findable` - export/privacy ownership and existing `/privacy` route stay linked
- `actor-switching-demo-only` - demo switching remains explicit and non-privileged
- `no-secret-payload-or-fallback-leak` - `/ops` and the validator stay metadata-only and fail closed

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- The additive code anchors are the official support / ops pack in
  `packages/observability`, the bounded `/ops` wiring in `apps/web/src/OpsPage.tsx`,
  and the fixture-only local validator in `apps/api/src/supportOpsDrill.ts`.
- The official `/ops` surface points to checked-in docs and existing pages; it
  does not execute live incident actions.

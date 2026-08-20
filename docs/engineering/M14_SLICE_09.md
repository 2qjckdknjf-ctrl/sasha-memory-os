# M14 Slice 09 - first-hour onboarding pack

Status: implementation slice on top of the official M14 Slice 01-08 packs and
the current Control Center / MCP / project-routing surfaces.

## Goal

Ship one additive, versioned, fail-closed first-hour onboarding pack that
points at the current official surfaces instead of inventing a new wizard, plus
one bounded local validator that fails closed when a required onboarding step is
missing, unnamed, ownerless, widened, or unsafe.

Official pack version: `m14-s09-v1`

Roadmap section: `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - `docs/engineering/M14_DOC_CATALOG.md`
  - `docs/engineering/M14_SLICE_08.md`
  - `docs/engineering/MCP_CURSOR.md`
  - `docs/engineering/M6_CHATGPT_PRODUCTION.md`
  - `docs/m0/CHATGPT_MCP_PLAN.md`
  - current `apps/web` Control Center routes for connections, projects, search,
    and privacy
  - current `apps/mcp-gateway` ChatGPT Mode A profile and explicit-project
    enforcement
  - existing local drill/test patterns in `apps/api/src`
  - `scripts/smoke-mcp-chatgpt.sh` and `scripts/smoke-api.sh` as evidence only
- Publish one official, versioned onboarding pack:
  - pack version `m14-s09-v1`
  - roadmap section `20.17`
  - required first-hour steps for ChatGPT Mode A, Cursor MCP, Control Center,
    explicit project routing, one candidate capture, search/read-after-write,
    and export/privacy/runbooks
- Keep the pack defensive only and fail closed:
  - ChatGPT Mode A stays exactly 7 tools
  - no owner-token bypass
  - explicit `project_id` stays required for write/admin/export paths
  - `MEMORY_OS_DEFAULT_PROJECT_ID` is ignored
  - no AISTROYKA fallback
  - no verified-memory writes as part of onboarding
  - no token or payload examples in the guide or validator output
  - no memory bodies or tokens in local validator output
  - production SQL apply is not part of onboarding
  - no live onboarding against production is part of this slice
- Keep the validator bounded and local only:
  - fixture/local-only manifest validation
  - explicit project override required; no canned passing fallback
  - no live write, admin, export, or SQL apply action

## Out of scope

- Applying SQL to any Supabase project
- A new onboarding wizard, support UI, or operations UI
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New verified-memory writes
- Live user-data walkthroughs against production
- Payload, exploit, or token examples in the onboarding guide
- Production apply implied by onboarding

## Official checklist

- `mode-a-seven-tools` - ChatGPT Mode A remains at exactly 7 tools
- `cursor-mcp-current-surface` - Cursor MCP onboarding reuses the current
  gateway guide
- `control-center-explicit-project` - Control Center onboarding requires an
  explicit project and never falls back
- `candidate-capture-only` - first-hour capture uses `capture.text`, not a
  verified-memory path
- `search-read-after-write` - search/read-after-write stays on the current
  surfaces
- `privacy-and-runbooks-findable` - export/privacy + runbooks stay findable on
  the current stack
- `no-secret-payload-or-fallback-leak` - guide and validator stay metadata-only
  and fail closed

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- The additive code anchors are the official onboarding pack in
  `packages/observability` and the bounded local validator in
  `apps/api/src/firstHourOnboardingDrill.ts`.
- The short operator-facing guide is `docs/engineering/ONBOARDING.md`.

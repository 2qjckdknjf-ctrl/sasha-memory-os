# M14 Slice 08 - GA documentation catalog

Status: implementation slice on top of the official M14 Slice 01-07 packs and
recipes.

## Goal

Ship one additive, versioned, fail-closed GA documentation pack that indexes the
current official docs instead of rewriting the product, plus one bounded local
validator that fails closed when a required official doc is missing, uncatalogued,
missing owner/status metadata, or widens the current defensive contract.

Official pack version: `m14-s08-v1`

Roadmap section: `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - `docs/engineering/M14_SLICE_01.md` through `docs/engineering/M14_SLICE_07.md`
  - `docs/engineering/RLS_MATRIX.md`
  - `docs/engineering/SECRETS_POLICY.md`
  - `docs/engineering/runbooks/`
  - `docs/engineering/privacy/EXPORT_DELETION_SLAS.md`
  - `docs/m0/CHATGPT_MCP_PLAN.md`
  - `docs/engineering/MCP_CURSOR.md`
  - current local drill/test patterns in `apps/api/src`
- Publish one official, versioned documentation pack:
  - pack version `m14-s08-v1`
  - roadmap section `20.17`
  - catalogued current official surfaces for SLO, soak, security review, DR,
    incident runbooks, export/deletion SLAs, dependency upgrade policy, RLS,
    secrets, and MCP Mode A
- Keep the catalog defensive only and fail closed:
  - GA candidate docs remain findable and versioned
  - every required surface has a checked-in owner and status in the catalog
  - ChatGPT Mode A stays exactly 7 tools
  - no owner-token bypass
  - explicit `project_id` stays required for write/admin/export/apply paths
  - `MEMORY_OS_DEFAULT_PROJECT_ID` is ignored
  - no AISTROYKA fallback
  - no verified-memory writes
  - no token or payload examples in the catalog
  - no memory bodies or tokens in validator output
  - production SQL apply is not implied by docs
- Keep the validator bounded and local only:
  - fixture/local-only manifest validation
  - explicit project override required; no canned passing fallback
  - no live write, admin, export, or apply action

## Out of scope

- Applying SQL to any Supabase project
- New onboarding, support, or operations UI
- A new docs-site vendor or parallel documentation product
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- New verified-memory writes
- Payload, exploit, or token examples in the catalog
- Production apply implied by documentation

## Official checklist

- `docs-findable-and-versioned` - GA candidate docs are indexed and versioned
- `required-surfaces-linked` - current official surfaces stay linked in one
  catalog
- `mode-a-seven-tools` - ChatGPT Mode A remains at exactly 7 tools
- `explicit-project-id-no-default-fallback` - validator ignores
  `MEMORY_OS_DEFAULT_PROJECT_ID` and blocks AISTROYKA fallback
- `no-secret-payload-or-verified-write-leaks` - catalog and validator stay
  metadata-only with zero verified writes

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- The additive code anchors are the official catalog pack in
  `packages/observability` and the bounded local validator in
  `apps/api/src/gaDocCatalogDrill.ts`.

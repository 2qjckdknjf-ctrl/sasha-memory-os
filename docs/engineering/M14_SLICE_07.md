# M14 Slice 07 - dependency upgrade policy

Status: implementation slice on top of the official M14 SLO, security-review,
DR drill, incident-runbook, and privacy SLA packs.

## Goal

Ship one additive, versioned dependency-upgrade-policy pack plus one bounded
local validator that proves the current stack keeps owner, rollback, contract
tests, smoke, Mode A surface, project-scope guards, ADR evidence, and telemetry
hygiene fail closed across dependency upgrades.

Official pack version: `m14-s07-v1`

Roadmap section: `20.17`

## In scope

- Reuse the current stack only:
  - `packages/observability`
  - current pnpm workspace and `pnpm-lock.yaml`
  - current CI gate in `.github/workflows/ci.yml`
  - existing ChatGPT MCP smoke `scripts/smoke-mcp-chatgpt.sh`
  - existing ADRs for MCP and secrets
  - existing contract tests in `apps/mcp-gateway` and workspace test suites
- Publish one official dependency upgrade policy pack:
  - pack version `m14-s07-v1`
  - roadmap section `20.17`
  - defensive-only invariants for owner, rollback, contract/smoke, protocol ADR
    evidence, explicit project scope, and log hygiene
- Keep upgrades checked in and fail closed:
  - every official upgrade policy names an owner
  - every official upgrade policy names a rollback note
  - contract tests and smoke remain required gates
  - MCP / protocol / SDK changes requires ADR references and contract evidence
  - ChatGPT Mode A stays exactly 7 tools
  - write/admin/apply paths require explicit `project_id`
  - MEMORY_OS_DEFAULT_PROJECT_ID is ignored
  - there is no AISTROYKA fallback
  - there is no owner-token bypass
  - there are no verified-memory writes
  - logs and CI output stay metadata-only
  - production SQL apply is never implied by a dependency bump
- Keep the validator bounded and local only:
  - fixture/local-only manifest validation
  - no live mass upgrade
  - no production SQL apply
  - no new vendor automation

## Out of scope

- Applying SQL to any real Supabase project
- Live production or staging dependency upgrades
- New support or operations UI
- Generic onboarding/documentation outside this policy
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- Dependabot, Renovate, or another new vendor
- New verified-memory writes

## Official checklist

- `upgrade-owner` - dependency upgrade policy has a checked-in owner
- `rollback-note` - dependency upgrade policy has a checked-in rollback note
- `contract-and-smoke-gate` - current contract tests, typecheck, audit, and
  smoke stay required
- `protocol-adr-and-contract-tests` - protocol or SDK changes require ADR and
  updated contract evidence
- `mode-a-seven-tools` - ChatGPT Mode A remains at exactly 7 tools
- `explicit-project-id-no-default-fallback` - write/admin/apply paths require
  explicit project scope and never fall back to AISTROYKA
- `no-secret-payload-or-verified-write-leaks` - upgrade notes and CI output stay
  metadata-only with no verified writes

## Notes

- No new dependency-management vendor is introduced in this slice.
- No new ChatGPT tool, new connector, or new operational UI is introduced.
- No production SQL apply is part of this work.
- No live mass upgrade is part of this slice.
- The bounded entry point is `scripts/dependency-upgrade-drill.sh`, which
  delegates to the typed local fixture harness in
  `apps/api/src/dependencyUpgradeDrill.ts`.

# Dependency upgrade policy

Official pack version: `m14-s07-v1`

Roadmap section: `20.17`

This policy is versioned, defensive only, and scoped to the existing Sasha
Memory OS stack. It does not authorize production SQL apply, live mass upgrade,
new vendors, or a parallel supply-chain product.

## Intake

Owner: Platform owner
Rollback: Revert the dependency change and `pnpm-lock.yaml`, rerun `pnpm typecheck`, `pnpm test`, and `scripts/smoke-mcp-chatgpt.sh`, and never apply SQL to production as part of rollback.

- Use the current pnpm workspace, existing `pnpm-lock.yaml`, and the current CI
  smoke path only.
- No new vendor is added unless the vendor is already present and a pin is required to encode policy.
- No live mass upgrade is allowed; ship one bounded PR at a time.
- Dependency bumps do not imply production SQL apply.

## Contract and smoke gate

Owner: Platform owner

- `pnpm typecheck`
- `pnpm test`
- `pnpm audit --audit-level=critical`
- `scripts/smoke-mcp-chatgpt.sh`
- `.github/workflows/ci.yml`
- Existing contract tests, typecheck, and smoke stay the merge gate.

## Protocol / SDK changes

Owner: Platform owner

- Do not silently bump `protocolVersion`.
- MCP / protocol / SDK changes requires ADR references before merge.
- ADR evidence: `docs/adr/ADR-001-canonical-memory.md`,
  `docs/adr/ADR-005-secrets-and-environments.md`
- Contract evidence: `apps/mcp-gateway/src/profile.test.ts`,
  `apps/mcp-gateway/src/rpc.test.ts`, `scripts/smoke-mcp-chatgpt.sh`,
  `.github/workflows/ci.yml`
- Contract tests and smoke must change in the same PR as the protocol or SDK
  bump.

## ChatGPT Mode A surface

Owner: Platform owner

- ChatGPT Mode A stays exactly 7 tools.
- Allowed tools:
  `memory.search`, `memory.get`, `context.project`, `capture.text`,
  `memory.store_decision`, `handoff.create`, `memory.set_status`
- Do not add owner or ops tools as part of an upgrade.

## Project scope and write/admin guards

Owner: Platform owner

- Any write, admin, or apply path requires explicit `project_id`.
- Ignore `MEMORY_OS_DEFAULT_PROJECT_ID`.
- Do not fall back to AISTROYKA (`44444444-4444-4444-8444-444444444401`).
- No owner-token bypass.
- No verified-memory writes as part of a dependency upgrade.
- Production SQL apply is never implied by a dependency bump.

## Log and CI hygiene

Owner: Platform owner

- Do not log tokens, secrets, memory bodies, or dependency-upgrade payloads in CI output, upgrade notes, or validator output.
- Use metadata-only upgrade notes and redacted examples.
- Keep `service_role`, auth headers, connector tokens, and memory bodies out of
  upgrade logs and CI output.

## Non-goals

- Dependabot, Renovate, or another new vendor when one is not already present
- New support or operations UI
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools
- Live mass upgrade or exploit validation
- Applying SQL to production

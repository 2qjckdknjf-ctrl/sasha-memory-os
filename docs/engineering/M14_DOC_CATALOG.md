# M14 GA documentation catalog

Version: `m14-s08-v1`

Roadmap section: `20.17`

This catalog indexes the current official GA-candidate documentation surfaces on
the existing stack. It does not create a new docs product, imply production SQL
apply, widen ChatGPT Mode A, add owner-token bypass, add AISTROYKA fallback, or
add verified-memory writes.

## Documentation contract

Owner: Platform owner
Status: current official

- GA candidate docs must be findable and versioned.
- Every catalogued surface names an owner and a status in this catalog.
- ChatGPT Mode A stays exactly 7 tools.
- Write, admin, export, and apply paths require explicit `project_id`;
  `MEMORY_OS_DEFAULT_PROJECT_ID` is ignored.
- Do not fall back to AISTROYKA (`44444444-4444-4444-8444-444444444401`).
- Do not log memory bodies, tokens, or payload bodies in catalog text or local validator output.
- Production SQL apply is not implied by these docs.

## SLO + error budgets

Owner: Platform owner
Status: current official
Primary doc: `docs/engineering/M14_SLICE_01.md`
Version: `m14-s01-v1`

- Official surface: SLO pack and bounded telemetry targets.
- Linked code anchor: `packages/observability/src/index.ts`

## Bounded soak

Owner: Platform owner
Status: current official
Primary doc: `docs/engineering/M14_SLICE_02.md`
Version: `m14-s02-v1`

- Official surface: bounded soak recipe and preflight against the current API
  and MCP paths.
- Linked code anchor: `apps/api/src/soakHarness.ts`

## Security review

Owner: Security owner
Status: current official
Primary doc: `docs/engineering/M14_SLICE_03.md`
Version: `m14-s03-v1`

- Official surface: defensive-only review pack for negative coverage.
- Linked docs: `docs/engineering/RLS_MATRIX.md`,
  `tests/security/rls_matrix.test.ts`

## DR restore drill

Owner: Platform owner
Status: current official
Primary doc: `docs/engineering/M14_SLICE_04.md`
Version: `m14-s04-v1`

- Official surface: fixture-only DR restore drill and restore evidence.
- Linked code anchor: `apps/api/src/restoreDrill.ts`

## Incident runbooks

Owner: Platform owner
Status: current official
Primary doc: `docs/engineering/M14_SLICE_05.md`
Version: `m14-s05-v1`

- Official surface: alert ownership and incident runbooks on the current stack.
- Linked docs: `docs/engineering/runbooks/alert-ownership-and-routing.md`,
  `docs/engineering/runbooks/`

## Export + deletion SLAs

Owner: Privacy owner
Status: current official
Primary doc: `docs/engineering/privacy/EXPORT_DELETION_SLAS.md`
Version: `m14-s06-v1`

- Official surface: export, deletion, correction, and retraction SLA notes.
- Linked doc: `docs/engineering/M14_SLICE_06.md`

## Dependency upgrade policy

Owner: Platform owner
Status: current official
Primary doc: `docs/engineering/DEPENDENCY_UPGRADE_POLICY.md`
Version: `m14-s07-v1`

- Official surface: bounded dependency-upgrade policy and local drill.
- Linked doc: `docs/engineering/M14_SLICE_07.md`

## RLS matrix

Owner: Security owner
Status: current official
Primary doc: `docs/engineering/RLS_MATRIX.md`
Version anchor: `m14-s08-v1`

- Official surface: current deny-first RLS and ACL matrix.
- Linked test anchor: `tests/security/rls_matrix.test.ts`

## Secrets policy

Owner: Security owner
Status: current official
Primary doc: `docs/engineering/SECRETS_POLICY.md`
Version anchor: `m14-s08-v1`

- Official surface: current secret-handling and redaction policy.
- Linked ADR anchor: `docs/adr/ADR-005-secrets-and-environments.md`

## MCP Mode A

Owner: Platform owner
Status: current official
Primary doc: `docs/m0/CHATGPT_MCP_PLAN.md`
Version anchor: `m14-s08-v1`

- Official surface: ChatGPT custom MCP plan and pilot tool contract.
- Linked docs: `docs/engineering/MCP_CURSOR.md`,
  `scripts/smoke-mcp-chatgpt.sh`
- ChatGPT Mode A tool count: `7`
- Allowed tools: `memory.search`, `memory.get`, `context.project`,
  `capture.text`, `memory.store_decision`, `handoff.create`,
  `memory.set_status`

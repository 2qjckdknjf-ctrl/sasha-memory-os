# M14 Slice 03 - security review + negative suite

Status: implementation slice on top of the official M14 SLO pack and bounded
load/soak recipe.

## Goal

Ship one additive, versioned security-review pack that reuses the current
RLS/ACL/API/MCP negative coverage and locks the current stack to defensive-only
behavior.

Official pack version: `m14-s03-v1`

## In scope

- Reuse the current stack only:
  - `tests/security/rls_matrix.test.ts`
  - `tests/security/rls_policy_cases.sql`
  - `docs/engineering/RLS_MATRIX.md`
  - `apps/api/src/supabase.rls.test.ts`
  - `packages/authz`
  - `apps/mcp-gateway/src/profile.test.ts`
  - `apps/mcp-gateway/src/tools.test.ts`
  - `packages/observability`
- Publish one official checklist pack:
  - pack version `m14-s03-v1`
  - roadmap section `20.17`
  - versioned invariants for defensive-only review coverage
- Keep the review defensive only:
  - reject unauthenticated MCP HTTP when API auth is enforced
  - deny wrong-workspace and cross-project access
  - keep personal memory default-deny for agents
  - keep ChatGPT Mode A at exactly 7 tools
  - keep owner-token bypass disallowed
  - require explicit `project_id` on write/admin paths
  - never default writes to AISTROYKA
  - keep verified-memory writes at zero for this review pack
  - never log memory bodies, payloads, or tokens
- Prove the slice with locally runnable tests:
  - pack/checklist stays versioned
  - existing deny paths remain denied
  - MCP HTTP auth helpers stay fail-closed
  - payload-redaction and zero verified-write invariants stay explicit

## Out of scope

- Pen-test payloads, exploit PoCs, or attack procedures
- New scanners, fuzzers, or attack harnesses
- Load/soak work, DR drills, or ops runbooks
- Calendar, Apple, Graphiti, or extra connector expansion
- New ChatGPT Mode A tools or profile widening
- SQL apply to production
- Writing new verified memory as part of this slice

## Official checklist

- `rls-matrix` — reuse RLS deny-first coverage and fixture docs
- `acl-default-deny` — keep personal/default-deny and unrelated-project denies
- `mcp-unauthenticated-reject` — keep MCP HTTP auth fail-closed
- `mode-a-surface` — keep ChatGPT Mode A at 7 tools
- `no-owner-token-bypass` — do not introduce owner bypass paths
- `no-aistroyka-fallback` — require explicit scope on writes/agentic paths
- `no-verified-write-or-payload-leak` — keep zero verified writes and redact
  bodies/tokens

## Notes

- No SQL migration is required for this slice.
- No production SQL apply is part of this work.
- The additive code anchor is the official security-review pack in
  `packages/observability`.

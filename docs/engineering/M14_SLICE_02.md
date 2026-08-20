# M14 Slice 02 - bounded load / soak harness

Status: implementation slice on top of M14 Slice 01 versioned SLO + error-budget pack.

## Goal

Add one official, versioned, bounded load/soak recipe that reuses the existing
API + MCP stack, records SLO observations through the current request/tool
hooks, and fails closed when availability, latency-budget, Mode A surface, or
payload-leak invariants break.

## In scope

- Reuse the current stack only:
  - `scripts/smoke-api.sh`
  - `scripts/smoke-mcp-chatgpt.sh`
  - `packages/observability` official SLO pack
  - API `/v1/search`, `/v1/projects/:id/state`, and write-receipt paths
  - MCP `memory.search`, `context.project`, and `capture.text`
- Add one official bounded recipe:
  - recipe version `m14-s02-v1`
  - roadmap sections `17.2`, `17.3`, `20.17`
- Keep the harness explicitly bounded:
  - low concurrency only
  - low round count only
  - per-request timeout in seconds, not hours
  - suitable for local runs and tiny CI bursts
- Keep writes safe:
  - no verified-memory writes
  - only idempotent candidate capture receipts
  - every write path carries an explicit `project_id`
  - no owner-token bypass
  - no AISTROYKA fallback when `project_id` is omitted
- Fail closed on regressions:
  - ChatGPT Mode A must remain exactly 7 tools
  - MCP profile must stay `chatgpt`
  - API/MCP availability must remain inside the current error budget
  - `search.hybrid`, `project.state`, and `write.receipt` p95 must remain
    within the official Slice 01 thresholds
  - harness outputs must not expose request bodies, tokens, or personal content
- Prove the slice with tests:
  - recipe is versioned and bounded
  - SLO observations are recorded by the existing hooks
  - no payload leak in telemetry/report output
  - Mode A tool count stays unchanged
  - no AISTROYKA fallback
  - no verified write is produced by the soak recipe

## Out of scope

- Pen testing
- DR drills
- 24-hour soak farms or long-running CI loops
- New vendors or load-test dependencies (`k6`, `locust`, etc.)
- New UI, dashboards, or ops surfaces
- New ChatGPT tools
- Ranking, Graphiti, or connector expansion work
- ACL widening
- Production SQL apply

## Notes

- No SQL migration is required for this slice; the bounded soak recipe reuses
  the existing request/tool hooks introduced in Slice 01.
- The official entry point is `scripts/soak-bounded.sh`, which delegates to the
  typed harness in `apps/api/src/soakHarness.ts`.
- The recipe intentionally requires an explicit project id from env/CLI input
  instead of falling back to `MEMORY_OS_DEFAULT_PROJECT_ID`.

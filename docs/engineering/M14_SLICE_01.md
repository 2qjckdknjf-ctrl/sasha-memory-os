# M14 Slice 01 - SLO + error budgets

Status: implementation slice on top of M13 Slice 06 versioned ranking weights.

## Goal

Make the private-beta SLO and error-budget targets explicit as one additive,
versioned pack in code and docs, then let the existing API and MCP request paths
record latency/error outcomes without logging memory bodies, tokens, or personal
content.

## In scope

- Reuse the existing stack:
  - `packages/observability`
  - API request paths in `apps/api`
  - MCP gateway request paths in `apps/mcp-gateway`
  - existing hybrid search and bounded agentic retrieval flows
- Add one official, versioned M14 SLO pack:
  - pack version `m14-s01-v1`
  - roadmap sections `17.2`, `17.4`, `20.17`
- Encode the current private-beta targets:

| Target | Objective | Budget policy in this slice |
| --- | --- | --- |
| API availability | 99.5% | 0.5% error budget |
| MCP availability | 99.5% | 0.5% error budget |
| `project.state` | p95 <= 700 ms | 5% slow-request budget |
| Hybrid search | p95 <= 2.0 s | 5% slow-request budget |
| Agentic retrieval | p95 <= 8.0 s | 5% slow-request budget |
| Durable write receipt | p95 <= 1.0 s | 5% slow-request budget |
| Webhook ack | <= 5.0 s | strict late-count budget in local snapshot |
| ACL leakage | 0 confirmed incidents | zero-tolerance budget |

- Keep telemetry bounded and local:
  - in-process counters only
  - bounded latency samples for snapshot math
  - no external APM vendor
- Sanitize structured logs:
  - redact memory bodies / `text` / `content`
  - redact tokens / secrets / authorization material
  - avoid persisting personal content in telemetry snapshots
- Add light hooks only:
  - API availability and request timing middleware
  - API search mode timing (`hybrid` vs `agentic`)
  - API `project.state`, write receipt, and webhook ack timing
  - MCP gateway tool-call availability and timing for search/context/write paths
- Prove safety with tests:
  - official pack is versioned
  - latency/error observations are recorded
  - telemetry snapshots/logs do not expose payload content
  - ChatGPT Mode A remains exactly 7 tools
  - no AISTROYKA fallback is introduced
  - bounded agentic retrieval still reports `writeActionsAttempted = 0`

## Out of scope

- Load / soak testing
- Penetration testing
- DR drills
- New dashboards or UI
- New ChatGPT Mode A tools
- Owner-token bypasses
- Verified-memory writes
- Ranking, training, or personalization changes
- Graph / Graphiti work
- Calendar / Apple / new connector families
- Production SQL apply

## Notes

- No SQL migration is required for this slice; the SLO pack and recorder are
  code-defined and process-local.
- This slice records bounded operational signals only. It does not change ACL
  policy, retrieval ranking, verified-memory semantics, or project routing.
- `webhook ack` is tracked as a deadline counter in the local snapshot so the
  existing receiver path can surface late acknowledgements without introducing a
  separate ops product.

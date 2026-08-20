# M13 Slice 02 - bounded multi-hop retrieval

Status: implementation slice on top of M13 Slice 01 bounded agentic retrieval.

## Goal

Add a small, additive multi-hop pass inside the existing bounded agentic
retrieval path so the current search surface can follow grounded evidence across
2-N bounded hops without introducing unbounded search, wider scope, or any
write side effects.

## In scope

- Extend the existing bounded agentic retrieval flow on the current search
  surface:
  - `packages/retrieval`
  - `POST /v1/search`
  - MCP `memory.search`
- Keep the allowlist read-only and unchanged for this slice:
  - `memory.search` only
- Reuse Slice 01 guardrails and budgets:
  - `max_steps`
  - `max_time_ms`
  - `max_tokens`
  - `max_cost_usd`
  - `min_evidence_hits`
- Require explicit `project_id` for agentic retrieval.
- Keep every hop scoped to the caller's explicit project and existing ACLs.
- Record each grounded hop in the existing trace/audit payload with:
  - hop kind
  - grounded memory ids/titles
  - hop query
  - hop result summary
- Support grounded follow-ups such as:
  - entity -> related decision/task/fact
  - current state vs superseded or corrected state
  - timeline/history expansion for the same scoped evidence
- Stop safely with `not_enough_data` when the next hop cannot be grounded.
- Preserve zero verified-memory writes and zero owner-token bypass.
- Keep ChatGPT MCP Mode A at exactly 7 tools.

## Out of scope

- New MCP tools or any increase beyond the current 7-tool ChatGPT Mode A
  surface
- Graph projection, Graphiti, or graph-native traversal
- Learned ranking or training a new reranker
- Proactive consolidation or any automatic verified write
- Calendar, Apple, or additional Gmail/Drive/GitHub product work
- Workspace-wide fallback or cross-project broadening
- Production SQL apply

## Notes

- This slice stays on the existing hybrid retrieval stack and bounded agentic
  path instead of creating a new product surface.
- No production SQL apply is required for the initial implementation.
- Trace shape is extended additively so existing callers still receive the
  bounded agentic result with extra hop metadata.

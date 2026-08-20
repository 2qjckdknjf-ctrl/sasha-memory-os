# M13 Slice 01 — bounded agentic retrieval

Status: implementation slice on top of the existing retrieval/search stack.

## Goal

Add one bounded agentic retrieval mode that can run a few search-only iterations
over the current Memory OS retrieval path without introducing a new write
surface, changing ChatGPT Mode A tool count, or widening caller scope.

## In scope

- Extend the existing search path instead of creating a new product surface:
  - `POST /v1/search`
  - existing MCP `memory.search`
  - `packages/retrieval`
- Add an optional bounded `agentic` retrieval mode on top of current hybrid
  search.
- Require an explicit `project_id` for the bounded agentic mode.
- Keep the run bounded by:
  - max steps
  - max time budget
  - max token budget
  - max cost budget
- Keep the tool allowlist read-only and small (`memory.search` only in this
  slice).
- Preserve caller ACL scope; agentic mode must never widen to workspace scope or
  another project.
- Record a durable trace of the bounded run in the existing audit log, including
  per-step query/result summaries.
- Return a safe `not_enough_data` outcome when the bounded loop cannot collect
  enough evidence.
- Keep write attempts at zero; verified memory writes remain a separate action.
- Add focused tests for:
  - explicit `project_id` requirement
  - no AISTROYKA fallback
  - scoped result filtering
  - bounded stop behavior
  - insufficient-data outcome
  - durable step trace
  - unchanged 7-tool ChatGPT Mode A surface

## Out of scope

- Graph retrieval or Graphiti integration
- Learned ranking or model-trained reranking
- Proactive consolidation or automatic verified writes
- Calendar watch, Apple expansion, extra Gmail/Drive/GitHub work
- New MCP tools or any increase beyond the existing 7-tool ChatGPT Mode A
  surface
- Owner-token bypasses or silent project defaults
- Production SQL apply

## Notes

- The slice reuses existing hybrid search, temporal filters, RRF reranking, and
  packed search context.
- Durable tracing reuses the existing audit log rather than introducing a new
  search-trace table in this slice.

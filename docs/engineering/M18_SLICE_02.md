# M18.2 — Project context pack API/MCP

Pack: `m18-s02-v1`

## Goal

Every agent receives the same compact, project-scoped operational context without reading an unbounded raw memory list or falling back to an unrelated project.

## Contract

The pack contains:

- current goal;
- canonical decisions;
- current milestone;
- active blockers;
- recent PR merges and merge SHAs when present in evidence;
- unresolved conflicts;
- next work;
- source freshness;
- claim-level citation identifiers and a citation catalog;
- subject/project provenance and a deterministic token budget receipt.

The default budget is 1,800 estimated tokens. Callers may request `max_tokens`; values are clamped to the supported 768–8,000 range. Lower-priority entries and summaries are reduced before the response is returned. The receipt reports requested maximum, final estimate, included counts, original counts, and whether truncation occurred.

## Surfaces

- `GET /v1/projects/:id/context-pack?max_tokens=...` exposes the compact API while the existing raw `/context` endpoint remains backward-compatible.
- Existing MCP tool `context.project` now returns the compact pack and accepts optional `max_tokens`.
- Supabase Edge `memory-mcp` uses the same field set and fail-closed project checks.
- Cursor bootstrap requests the compact pack directly and keeps its own bounded output stable.
- ChatGPT Mode A remains exactly seven tools; no additional public action is introduced.

## Safety boundaries

- `project_id` is mandatory for MCP context reads and the API project ID is an explicit path parameter.
- No default project substitution is permitted.
- The response echoes the resolved project ID.
- A mismatched response-level project or any mismatched source record fails closed.
- Only records already visible to the authenticated subject are packed.
- Every returned claim carries citation IDs; citation metadata preserves source ID, project ID, recorded time and source-event provenance.
- Freshness is computed from the newest readable source using the 24-hour operational SLA; absence of a trustworthy timestamp is reported as `unknown`.

## Acceptance

- Shared schema, API, full MCP and production Edge implementations return `m18-s02-v1`.
- 900-token contract tests prove bounded output and deterministic truncation.
- Cross-project fixtures fail closed.
- Personal-memory ACL tests remain green after the MCP switches from raw lists to the compact pack.
- Existing raw API clients remain compatible.
- Tool discovery remains exactly seven actions.
- Production Edge deployment and an authenticated live context read are required after merge before the milestone is written.

Next slice: `M18.3_ROMA_INTEGRATION`.

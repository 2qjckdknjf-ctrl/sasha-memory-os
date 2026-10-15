# M18.2 — Project context pack API/MCP

Pack: `m18-s02-v1`

## Goal

Every agent receives the same compact, project-scoped operational context without reading an unbounded raw memory list or falling back to an unrelated project.

## Contract

The pack contains:

- current goal;
- canonical decisions;
- current milestone;
- latest agent handoff, including completed work, validation, open items, blockers and recommended next steps;
- active blockers;
- recent PR merges and merge SHAs when present in evidence;
- unresolved conflicts and officially recorded project-state risks;
- next work;
- source freshness;
- claim-level citation identifiers and a citation catalog;
- subject/project provenance and a deterministic token budget receipt.

The default budget is 1,800 estimated tokens. Callers may request `max_tokens`; values are clamped to the supported 768–8,000 range. Lower-priority entries and summaries are reduced before the response is returned. At the minimum budget, redundant next-work and milestone copies plus display text and citation titles may also be compacted while at least one readable canonical decision and one latest merge remain when merge evidence exists. The receipt reports requested maximum, final estimate, included counts, original counts, and whether either token pressure or a fixed section/text cap omitted source content.

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
- Project state and handoff data are optional sources and each requires its own `read` ACL; `memory.read` alone never exposes either source.
- Every returned claim carries citation IDs; citation metadata preserves source ID, project ID, recorded time and source-event provenance.
- Freshness is computed from the newest readable memory, project-state update or handoff using the 24-hour operational SLA; absence of a trustworthy timestamp is reported as `unknown`.
- Active task memories and officially tracked `state.in_progress` items participate in current goal and next-work selection. A newer project-state snapshot supersedes older milestone next-work and blocker text, including an explicitly cleared blocker list.
- Explicit no-blocker sentinels such as `none`, `no blockers`, `n/a` and their Russian equivalents are normalized to an empty blocker set.
- A GitHub PR URL is classified as a recent merge only when the same memory also carries a merge SHA or an explicit merged-status marker; review-stage and open PR links are not presented as merged.

## Acceptance

- Shared schema, API, full MCP and production Edge implementations return `m18-s02-v1`.
- 768-token contract tests prove bounded output, latest-merge retention and deterministic truncation.
- Cross-project fixtures fail closed.
- Personal-memory ACL tests remain green after the MCP switches from raw lists to the compact pack.
- Existing raw API clients remain compatible.
- Tool discovery remains exactly seven actions.
- Production Edge deployment and an authenticated live context read are required after merge before the milestone is written.

## Production receipt — 2026-10-15

- PR #100 merged as `d9325ae838f4f9e538b732af1f5dc88092e44412`; live-acceptance fix PR #102 merged as `c9a8281d57495734b5822ed9cd7c4c4f1994533b`.
- Migration `20261013164246_m18_project_context_source_acl.sql` applied successfully after green main CI.
- `memory-mcp` Edge Function v11 is ACTIVE with the existing custom secret authentication and SHA-256 `bb62483bf3eeb9d0511a74bbab1e86bd4ff08213fda18200b035407bc7083fee`.
- Live tool discovery returned exactly seven tools; `context.project` exposes optional `max_tokens`.
- Canonical Cursor Edge bootstrap returned `m18-s02-v1`, current milestone M18.1, PR #99 and merge SHA `9d7e9216a5567455cf7dd6b9a8bec62dfb5739eb`, fresh citations, and 1,788 estimated tokens within the 1,800-token budget.
- AISTROYKA returned its explicit project ID and only same-project citations; the ChatGPT subject received no handoff, proving no fallback and source-specific handoff ACL enforcement.
- Post-DDL advisors: security counts 2 RLS-without-policy INFO, 1 public-extension WARN, 1 leaked-password WARN; performance counts 75 unindexed foreign keys, 30 unused indexes, 42 multiple permissive policies, and 1 absolute Auth connection setting.
- Memory OS milestone `9ac3fb2e-95de-42aa-aa34-e9954dc0228c` is verified and passed read-after-write.

Next slice: `M18.3_ROMA_INTEGRATION`.

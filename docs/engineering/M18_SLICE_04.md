# M18.4 — ChatGPT automatic writeback policy

Pack: `m18-s04-v1`

## Scope

- ChatGPT Mode A remains exactly seven tools. Automatic writeback is an optional policy envelope on the existing `memory.store_decision` tool; ordinary manual calls remain compatible.
- Only the canonical ChatGPT subject can invoke the policy path, with an explicit workspace/project, internal sensitivity, a supported writeback kind, approval provenance, and one to twelve bounded evidence references.
- Approved decisions require an explicit-user approval reference. Completed milestones accept explicit-user approval or a verified-workflow reference.
- PostgreSQL validates idempotency before content dedupe, then performs read-before-write under a transaction advisory lock. An exact normalized policy-backed match is reused and returns only its persisted provenance, while the same normalized title with different content or unverified provenance returns `review_required` and writes no memory.
- New writes preserve the `m18-s04-v1` provenance envelope in both the source event and memory metadata, append a bounded audit event, and must pass an ACL-aware `api_get_memory` read-after-write check before success is returned.
- The Edge MCP handler and the hosted/local Supabase gateway call the same database policy RPC. Offline in-memory execution fails closed for automatic writeback because it cannot enforce the centralized policy transaction.

## Security and privacy invariants

- No eighth public ChatGPT action is added.
- The database rejects non-ChatGPT actors, missing projects, non-internal sensitivity, missing/invalid approvals, missing evidence, oversized fields, and reused idempotency keys with different provenance.
- Content is represented in provenance only by a SHA-256 fingerprint; audit records never copy the raw body.
- Conflicts never overwrite, supersede, or create a memory automatically.
- Manual `memory.store_decision` behavior remains unchanged when `writeback` is absent.

## Acceptance

- Schema, Edge-contract, gateway, security-pack, type, lint, and repository tests must pass.
- Ephemeral Supabase must prove create, exact dedupe, conflict stop, missing-evidence rejection, non-ChatGPT rejection, provenance persistence, audit events, and read-after-write.
- After merge and green main CI, apply migration `20261015190000_m18_chatgpt_automatic_writeback.sql`, deploy `memory-mcp`, verify the remote surface still lists exactly seven tools, and run live create/dedupe/conflict/read-after-write acceptance.
- M18.4 is not complete until the live receipt is committed and a verified Memory OS milestone passes read-after-write.

## Production receipt

- Implementation PR: [#108](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/108), squash SHA `8b07131c87e0cd2968c0c679c487a477bafc3bf4`.
- PR CI `38768894752` and CodeQL `38768886451` passed. Post-merge main CI `38769327729` and CodeQL `38769327681` passed.
- Production migration record: `20261015164907_m18_chatgpt_automatic_writeback` (repository migration `20261015190000_m18_chatgpt_automatic_writeback.sql`).
- `memory-mcp` is ACTIVE at Edge version 12, SHA-256 `6ac58816f4a6b1fd19383fa1aab2244d353d208e9aeacbe76985f35a253dedbc`.
- Remote `tools/list` returned exactly seven tools and exposed the optional `writeback` envelope only on `memory.store_decision`.
- Live acceptance key `m18-s04-live-20261015T165036Z-14827` created verified memory `5375c33d-1a98-47af-9554-d9b90c6449aa`.
- A retry with different caller-supplied approval/evidence deduplicated to the same memory and returned its persisted provenance. A same-title/different-content request returned `review_required`, `writePerformed: false`, and no memory.
- Database provenance, the source event, and all three audit outcomes (`created`, `deduplicated`, `review_required`) were verified.
- ACL-aware `memory.get` and `memory.search` read-after-write both passed. Search inclusion, not top-rank placement, is the acceptance condition.

## M18 exit gate

ChatGPT `context.project`, Cursor session bootstrap, and ROMA subject-scoped project context all resolved to the same verified canonical state memory `5375c33d-1a98-47af-9554-d9b90c6449aa` for project `44444444-4444-4444-8444-444444444402` inside the freshness SLA. ROMA used subject `33333333-3333-4333-8333-333333333304`; no owner impersonation or workspace-wide ACL was used.

The verified Memory OS completion receipt is `b664431d-7e33-49f3-bd3b-27dbb24150f0`; an immediate ACL-aware read-after-write returned the stored decision.

Post-migration advisors remain tracked for M20: two RLS-enabled-without-policy informational notices, one public-schema vector extension warning, leaked-password protection disabled, 75 unindexed foreign keys, 25 unused indexes, 42 multiple-permissive-policy notices, and one auth connection-strategy notice.

Current status: M18.4 and the M18 cross-client exit gate are live-complete. Next canonical slice: `M19_CONTROL_CENTER_GOVERNANCE_COMPLETION`.

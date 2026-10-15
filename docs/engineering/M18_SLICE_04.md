# M18.4 — ChatGPT automatic writeback policy

Pack: `m18-s04-v1`

## Scope

- ChatGPT Mode A remains exactly seven tools. Automatic writeback is an optional policy envelope on the existing `memory.store_decision` tool; ordinary manual calls remain compatible.
- Only the canonical ChatGPT subject can invoke the policy path, with an explicit workspace/project, internal sensitivity, a supported writeback kind, approval provenance, and one to twelve bounded evidence references.
- Approved decisions require an explicit-user approval reference. Completed milestones accept explicit-user approval or a verified-workflow reference.
- PostgreSQL performs read-before-write under a transaction advisory lock. An exact normalized policy-backed match is reused, while the same normalized title with different content or unverified provenance returns `review_required` and writes no memory.
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

Current status: implementation prepared; production live acceptance pending.

# M18.3 — ROMA shared-memory integration

Pack: `m18-s03-v1`

## Scope

- ROMA reads one explicit, subject-scoped `m18-s02-v1` project context pack before producing project-health or QA outcomes.
- Existing `roma_project_health` and `roma_project_findings` jobs remain the execution surface; no new public MCP tool is added.
- QA and release-risk outcomes carry the context-pack version, citations, audit provenance, and available pull-request, merge-commit, and deployment-receipt references.
- Finding idempotency includes the evidence fingerprint. Identical evidence reuses one revision; changed release evidence creates a new deterministic revision.
- Heuristic ROMA outputs remain `candidate`, confidence `0.6`, `requires_review=true`, and `auto_verify_allowed=false`. The worker reads each stored memory back and fails closed if it is not a ROMA-authored candidate in the requested project.
- Migration `20261015164000_m18_roma_release_evidence.sql` preserves bounded PR/commit/deployment references when a finding enters the existing human approval-checkpoint path; unsafe URLs and unrelated fields are discarded.

## Security and privacy invariants

- The project UUID is mandatory and echoed by the context pack; default-project fallback is forbidden.
- ROMA executes only as the configured ROMA service subject.
- Raw memory bodies are not copied into ROMA summaries or findings; only bounded titles, structured pack claims, citations, and release references are written.
- Personal, confidential, restricted, and cross-project sources remain excluded by the existing ACL-aware `api_project_context` and capture RPCs.
- ChatGPT Mode A remains exactly seven tools.

## Acceptance

- Schema, worker, security-pack, type, lint, and full repository tests pass.
- Tests prove context-pack consumption, stable dedupe, revision changes when the merge SHA changes, PR/commit/deployment references, audit metadata, and candidate-only read-after-write enforcement.
- The production worker treats an unset or whitespace-only optional `MEMORY_OS_ROMA_SUBJECT_ID` as the canonical ROMA service subject instead of passing an empty UUID to privileged RPCs.
- Structured Supabase failures preserve their bounded message and code in worker diagnostics; they must never collapse to `[object Object]`.
- Migration `20261015180000_m18_roma_canonical_project_acl.sql` grants ROMA only the canonical project's internal memory read/write plus project, project-state, and handoff read capabilities required by the existing worker. It adds no handoff write, workspace-wide, or personal-data access.
- After merge, run one real canonical-project ROMA job against production, verify the resulting memory is candidate and project-scoped, and record a Memory OS milestone with read-after-write.

## Production receipt — 2026-10-15

- Implementation PR #104 merged as `50a89d0adf24b8aa4dfd201e93a4b33bfbd7462f`; production runtime fix PR #105 merged as `d8bab09295d6437b500fb9bcb11e7d49c0561679`; canonical ACL PR #106 merged as `960f280a1de8ef958f8c532f688ff3bbbadcac69`.
- Main CI run `38764027979` passed smoke, ephemeral-contract, and live-edge-smoke; CodeQL run `38764026942` passed.
- Production migration record `20261015155505_m18_roma_canonical_project_acl` applied after green main CI. ROMA has canonical-project memory read/write plus project, project-state, and handoff read; handoff write is absent and workspace-wide ROMA ACL count is zero.
- Worker run `38764649250` passed consolidation, ROMA, and connector steps. ROMA job `a5f6a9af-5537-40be-afb4-a9f542c88447` succeeded on attempt 1 and wrote three project-scoped internal findings as ROMA.
- Memories `7e066738-1807-4e28-a342-21ff16c286ea`, `b4d85980-bd6b-4c6d-9d5c-62eebcac665d`, and `796e7721-201e-4bac-9682-124eb8a4664a` remain candidate with confidence `0.6`; each has `roma.qa_finding.written` audit evidence and one bounded action-budget event.
- Memory `7e066738-1807-4e28-a342-21ff16c286ea` passed MCP read-after-write. Milestone `ea0746e7-6557-4c66-b017-005e3c06f157` is verified and passed read-after-write.
- Post-DDL advisors are unchanged known debt: security counts 2 RLS-without-policy INFO, 1 public-extension WARN, 1 leaked-password WARN; performance counts 75 unindexed foreign keys, 30 unused indexes, 42 multiple permissive policies, and 1 absolute Auth connection setting.

M18.3 is complete. Next slice: `M18.4_CHATGPT_AUTOMATIC_WRITEBACK_POLICY`.

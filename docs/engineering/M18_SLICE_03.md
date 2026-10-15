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
- After merge, run one real canonical-project ROMA job against production, verify the resulting memory is candidate and project-scoped, and record a Memory OS milestone with read-after-write.

Implementation does not advance `completedThrough` beyond M18.2 until the production acceptance above passes.

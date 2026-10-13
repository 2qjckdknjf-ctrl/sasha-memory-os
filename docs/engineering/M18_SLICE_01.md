# M18.1 — Cursor bootstrap contract

Pack: `m18-s01-v1`

## Goal

Every substantial Cursor task uses the same canonical Sasha Memory OS context and closes the loop after merge. A task is substantial when it changes code, schema, configuration, deployment state, or release documentation.

## Mandatory A–G lifecycle

1. **A — Memory bootstrap.** Run the project-scoped bootstrap command before editing. It searches the canonical completion plan and current project context.
2. **B — Git inspection.** Bootstrap fetches `origin/main` and reports HEAD, branch, merge-base, recent main commits, and the full working-tree summary.
3. **C — Bounded slice.** Define one capability, its acceptance evidence, known blockers, and the next slice.
4. **D — Implement/test.** Run proportionate unit, contract, security, integration, build, and live checks.
5. **E — PR/merge.** Create one PR, resolve findings, wait for required CI, and merge. Production mutations occur only after merge and CI acceptance.
6. **F — Writeback.** Store the merged milestone with PR URL, merge SHA, results, blockers, and next work under the explicit canonical project UUID.
7. **G — Read-after-write.** `store-decision` immediately calls `memory.get` and fails unless ID, project, title, and content match.

## Commands

Bootstrap:

```bash
node scripts/cursor-mcp-session.mjs bootstrap \
  --project-id 44444444-4444-4444-8444-444444444402
```

Post-merge milestone plus automatic read-after-write:

```bash
node scripts/cursor-mcp-session.mjs store-decision \
  --project-id 44444444-4444-4444-8444-444444444402 \
  --title "<milestone>" \
  --content "<PR, merge SHA, evidence, blockers, next slice>" \
  --idempotency-key "<unique-key>"
```

Success requires top-level `id` and `readAfterWrite.verified=true`. The command keeps the top-level write result for backwards compatibility with shared-memory E2E automation.

## Enforcement surfaces

- Root `AGENTS.md` contains the complete lifecycle for all compatible agents.
- `.cursor/rules/memory-os-lifecycle.mdc` is an always-on project rule.
- `.cursor/hooks.json` installs a version-controlled `sessionStart` hook for trusted local, CLI, and Cloud Cursor workspaces.
- The hook injects the canonical UUID, current local Git snapshot, required command, and A–G reminder. It never reads secrets or performs network writes.
- `scripts/cursor-mcp-session.mjs bootstrap` performs the authoritative live Memory OS searches, reads latest decisions through `context.project`, and fetches fresh `origin/main`.
- The workflow uses the full stdio MCP gateway when a service-role key is available (for example, ephemeral CI) and otherwise uses the authenticated production Edge MCP. Both transports address the same canonical database; no key is generated or copied.
- `tests/security/m18_slice_01_pack.test.ts` prevents drift in the rule, hook, UUID, pack version, and read-after-write behavior.
- The existing ephemeral shared-memory contract exercises the real Cursor stdio `store-decision`; it now also exercises the automatic `memory.get` verification.

Cursor project rules and hooks are version-controlled under `.cursor/` and apply to trusted workspaces and Cloud Agents. Official references: [Rules](https://cursor.com/docs/rules) and [Hooks](https://cursor.com/docs/hooks).

## Fail-closed boundaries

- Project UUID is always explicit; no `MEMORY_OS_DEFAULT_PROJECT_ID` fallback.
- The workflow uses the Cursor subject `33333333-3333-4333-8333-333333333303` and canonical workspace `11111111-1111-4111-8111-111111111111`.
- If live Memory OS or fresh `origin/main` cannot be read, the task records a blocker and cannot claim completion.
- Milestone writeback only happens after the PR is merged.
- Secrets remain in the private environment and are never included in hook output, logs, repository files, or milestone content.

## Acceptance

- Schema contract publishes ordered steps A–G and fail-closed invariants.
- Always-on rule and session hook are present and executable with valid JSON I/O.
- Bootstrap uses two explicit-project `memory.search` calls and fresh Git evidence.
- `store-decision` performs and validates `memory.get` before returning success.
- Root test suite and ephemeral shared-memory CI pass without changing the seven-tool ChatGPT Mode A contract.

Next slice: `M18.2_PROJECT_CONTEXT_PACK`.

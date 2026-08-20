# First-hour onboarding

Version: `m14-s09-v1`

Roadmap section: `20.17`

This guide is the current official first-hour onboarding pack for Sasha Memory
OS. It is intentionally fail-closed and reuses the current ChatGPT, Cursor MCP,
Control Center, project-routing, privacy, and runbook surfaces. It does not
create a new wizard, support UI, or operations UI.

## Contract

- Reuse the current official surfaces listed in
  `docs/engineering/M14_DOC_CATALOG.md` and introduced by
  `docs/engineering/M14_SLICE_08.md`.
- ChatGPT Mode A stays exactly 7 tools.
- Any write, admin, or export step requires an explicit `project_id`.
  `MEMORY_OS_DEFAULT_PROJECT_ID` is ignored.
- Never rely on AISTROYKA fallback
  `44444444-4444-4444-8444-444444444401`.
- Do not use `memory.store_decision` or `memory.set_status` as part of onboarding.
- The onboarding write path is candidate capture only.
- Do not paste tokens, secrets, memory bodies, or raw payloads into this guide.
- Production SQL apply is not part of onboarding.
- `scripts/smoke-mcp-chatgpt.sh` and `scripts/smoke-api.sh` are evidence only,
  not the onboarding flow.

## Connect ChatGPT Mode A

Owner: Platform owner
Status: current official

- Follow `docs/m0/CHATGPT_MCP_PLAN.md` together with
  `docs/engineering/M6_CHATGPT_PRODUCTION.md`.
- Confirm Scan Tools shows exactly these 7 tools:
  `memory.search`, `memory.get`, `context.project`, `capture.text`,
  `memory.store_decision`, `handoff.create`, `memory.set_status`.
- Stop if ChatGPT exposes fewer or more than 7 tools.
- Do not widen the profile with owner or operations tools.

## Connect Cursor MCP

Owner: Platform owner
Status: current official

- Follow `docs/engineering/MCP_CURSOR.md`.
- Reuse the checked-in stdio / HTTP gateway instructions instead of inventing a
  new onboarding config.
- Keep the current MCP gateway surface.
- Do not add a parallel onboarding connector.

## Open Control Center

Owner: Platform owner
Status: current official

- Open the current Control Center home at `/`.
- The first-hour surfaces are the existing `/connections`, `/projects`,
  `/search`, and `/privacy` routes.
- Use the existing Project Scope panel and project pages; do not route a new
  owner through `/ops`.

## Pick explicit project

Owner: Platform owner
Status: current official

- Before any write, admin, or export step, choose a project from `/projects` or
  the global Project Scope panel.
- Keep an explicit `project_id` on the current route or MCP tool call.
- Ignore `MEMORY_OS_DEFAULT_PROJECT_ID`.
- Never use AISTROYKA fallback
  `44444444-4444-4444-8444-444444444401` as a default.

## Capture one memory

Owner: Platform owner
Status: current official

- Use `capture.text` from ChatGPT Mode A or Cursor MCP.
- Pass an explicit `project_id`.
- Use a harmless non-sensitive onboarding note in local or staging validation,
  not live user data and not production onboarding.
- Do not use `memory.store_decision` or `memory.set_status` as part of onboarding.
- Those paths create or mutate verified state, and verified-memory writes are
  out of scope here.

## Search and read-after-write

Owner: Platform owner
Status: current official

- Use `memory.search` and `memory.get` on the selected project after capture.
- Use `context.project` if you need the current project state around the new
  candidate memory.
- In Control Center, use `/search` to confirm read-after-write on the same
  explicit project.
- This step confirms retrieval only; it does not verify or promote the memory.

## Find export, privacy, and runbooks

Owner: Privacy owner
Status: current official

- Use `/privacy` in Control Center for the current owner export and privacy
  request surface.
- Use `docs/engineering/privacy/EXPORT_DELETION_SLAS.md` for export, deletion,
  correction, and retraction rules.
- Use `docs/engineering/runbooks/` for incident ownership, revoke, and
  rollback/recovery references.
- Production SQL apply is not part of onboarding.

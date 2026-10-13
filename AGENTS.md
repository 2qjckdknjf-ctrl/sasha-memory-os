## Learned User Preferences

- Prefers agents to continue critical-path implementation without pausing for confirmation mid-workstream when asked to keep going (e.g. «продолжай без остановки»): after each step, verify, fix errors before advancing, and do not leave unfinished tails. Do not stop to ask questions or assign tasks back to the user—execute the agreed plan autonomously; they will review and correct later.
- Prefers concise status updates over long explanations during autonomous implementation runs («меньше слов»).
- Prefers agents to stay on the agreed plan and not deviate into unrelated work.
- Prefers status updates and agent replies in Russian when the user writes in Russian.

## Learned Workspace Facts

- This workspace is Sasha Memory OS: an external canonical long-term Memory Core shared by ChatGPT, Cursor, ROMA, and future agents (ACL, temporal model, provenance).
- Stack is a pnpm/TypeScript monorepo with `apps/`, `workers/`, `packages/`, `connectors/`, `supabase/`, and `tests/` (package scope `@memory-os/*`).
- Canonical baseline spec and diagrams live under `docs/baseline/`; M0 scope, ADRs, and engineering notes live under `docs/`.
- Dedicated Supabase project is `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, region `eu-central-1`); do not reuse AISTROYKA/HiAir Supabase projects for this workspace.
- On this machine prefer `npx pnpm@9.15.9` (local Volta pnpm shim is broken); Supabase CLI may be wrong architecture—fall back to remote SQL/API when the CLI cannot run.
- Local API defaults to `http://localhost:8787` with `backend=supabase`; keep `service_role` and `MEMORY_OS_API_SECRET` server-side / in local `.env` only (never commit).
- Canonical local project root is `/Users/alex/MAMORYOS/MAMORUOS` (renamed from `Без названия`); prefer the `Users-alex-MAMORYOS-MAMORUOS` Cursor project slug over the older `Users-alex-MAMORYOS` one.
- Default SQL hybrid embeddings use `vector(32)` / dims 32; optional HQ path is 1536 via `MEMORY_OS_OPENAI_EMBED_DIMS` (do not assume dims>32 is the active default).
- Canonical execution order after M14 is Memory OS decision `SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21`; machine-readable repo snapshot is `docs/engineering/CURRENT_STATE.json`.

## Cursor Cloud specific instructions

- Toolchain: Node 22 is preinstalled. The repo pins `pnpm@9.15.9` via `packageManager`, but the default `pnpm` on PATH may be a mismatched nvm version. Prefer `corepack pnpm@9.15.9 <cmd>` or `npx pnpm@9.15.9 <cmd>`.
- Standard commands live in `README.md` and root `package.json` scripts (`typecheck`, `test`, `dev:api`, `dev:web`). `pnpm lint` is a placeholder no-op.
- The API can boot without secrets in seeded in-memory `backend=memory-store` mode when Supabase env + `MEMORY_OS_API_SECRET` are not all set (`apps/api/src/server.ts`). Verify via `GET /health`.
- With `MEMORY_OS_ENV` unset/`local` (default), owner/cron ops routes do not require the API secret (`apps/api/src/httpAuth.ts`).
- Dev servers: `dev:api` on `:8787`; `dev:web` on `:5173` proxies `/v1` and `/health` to `:8787`. Start the API first.
- `pnpm test` passes without secrets; live Supabase suites auto-skip when env is absent. Live connector/OAuth/re-embed/consolidation need the dedicated Supabase project secrets.

## Mandatory Cursor memory lifecycle (M18.1)

For every substantial task (code, schema, configuration, deployment, or release documentation), execute this sequence in order:

A. Run `node scripts/cursor-mcp-session.mjs bootstrap --project-id 44444444-4444-4444-8444-444444444402`. This performs explicit-project `memory.search` calls for the canonical completion plan and current project context.
B. Inspect the freshly fetched `origin/main`, current branch, HEAD, recent main commits, and working-tree status returned by bootstrap. Preserve unrelated user changes.
C. Define one bounded execution slice with acceptance evidence and blockers. Do not mix unrelated capabilities in one PR.
D. Implement and run proportionate tests, lint, typecheck, security checks, and live acceptance where applicable.
E. Create a PR, resolve review findings, wait for required CI, and merge before any production migration/deployment or milestone claim.
F. After merge, write one milestone/decision containing PR URL, merge SHA, verification results, blockers, and next slice using `store-decision` with an explicit project UUID and unique idempotency key.
G. Treat the command's automatic `memory.get` read-after-write receipt as mandatory. Do not claim completion if it is absent or mismatched.

If live Memory OS access is unavailable, stop the substantial task at that boundary and report the blocker; never substitute in-memory/default-project context or write to AISTROYKA/HiAir. The always-on Cursor rule is `.cursor/rules/memory-os-lifecycle.mdc`; the session hook is `.cursor/hooks.json`.

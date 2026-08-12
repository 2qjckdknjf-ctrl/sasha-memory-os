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

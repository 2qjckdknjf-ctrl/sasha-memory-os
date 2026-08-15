# M6 — ChatGPT production MCP closeout

## Goal

Expose one stable HTTPS MCP endpoint for ChatGPT, restricted to the `chatgpt` profile, backed by the dedicated Sasha Memory OS Supabase project. After end-to-end acceptance, keep one ChatGPT app registration named **Sasha Memory OS** and retire older pilot registrations.

## Hosted runtime contract

The hosted API process serves both the HTTP API and Streamable HTTP MCP endpoint:

- `GET /health`
- `GET /mcp/health`
- `GET /mcp` → `405` with `Allow: POST`
- `POST /mcp` → JSON-RPC MCP

Required hosted configuration:

```text
MEMORY_OS_ENV=staging            # switch to production after acceptance
MEMORY_OS_MCP_PROFILE=chatgpt
MEMORY_OS_REQUIRE_API_AUTH=1
MEMORY_OS_SUPABASE_URL=...
MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY=...
MEMORY_OS_API_SECRET=...
```

Optional explicit profile defaults:

```text
MEMORY_OS_CHATGPT_SUBJECT_ID=33333333-3333-4333-8333-333333333302
MEMORY_OS_DEFAULT_WORKSPACE_ID=11111111-1111-4111-8111-111111111111
MEMORY_OS_DEFAULT_PROJECT_ID=44444444-4444-4444-8444-444444444401
```

Never commit real secret values.

## Allowed ChatGPT tools

The ChatGPT profile must expose exactly:

1. `memory.search`
2. `memory.get`
3. `context.project`
4. `capture.text`
5. `memory.store_decision`
6. `handoff.create`
7. `memory.set_status`

Owner/ops tools such as OAuth, connector administration, embeddings, consolidation, outbox operations, and extraction must not be exposed by this profile.

## Deploy

The repository keeps Fly.io scaffolding in `fly.toml`. The image must build before any hosted rollout:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
docker build -f apps/api/Dockerfile -t memory-os-api:m6 .
```

Set runtime secrets in the host secret store, then deploy using the selected host. Do not pass secret values through shell history or commit them to repository files.

The current Fly configuration enables HTTPS and the ChatGPT MCP profile. `min_machines_running=0` is acceptable for alpha validation but may introduce a cold start. Before declaring production-grade availability, decide whether to keep one machine warm or move the endpoint to another durable host.

## Remote smoke

After a public HTTPS URL is live:

```bash
MEMORY_OS_API_BASE_URL=https://HOST \
MEMORY_OS_API_SECRET='***' \
./scripts/smoke-mcp-chatgpt.sh
```

Expected sequence:

1. `/mcp/health` returns `ok: true`, `profile: chatgpt`, backend `supabase`.
2. `GET /mcp` returns `405`.
3. `initialize` succeeds.
4. `tools/list` returns only the seven allowed tools.
5. `memory.search` succeeds with profile defaults.
6. `memory.store_decision` succeeds and returns a memory id.
7. The written decision is visible through Memory OS retrieval / Web review.

## ChatGPT registration

Create or update one Developer Mode app:

- Name: `Sasha Memory OS`
- MCP URL: `https://HOST/mcp`
- Authentication: Bearer token using `MEMORY_OS_API_SECRET`

Then validate from a normal ChatGPT conversation:

1. Search a known memory using `pack_context=true`.
2. Fetch a returned memory with `memory.get`.
3. Write a unique test decision.
4. Search for the unique test decision and confirm it is returned.
5. Capture a short test note with `capture.text` and confirm it enters the expected review/candidate flow.

## Duplicate registration cleanup

Do not remove old registrations until the final app passes the full read/write loop. After acceptance:

- Keep: `Sasha Memory OS`
- Remove: `Sasha Memory OS Pilot`
- Remove: `Sasha MOS 27772`

## M6 exit criteria

M6 is complete only when all of the following are true:

- [ ] Stable public HTTPS endpoint exists.
- [ ] Hosted process uses `MEMORY_OS_MCP_PROFILE=chatgpt`.
- [ ] Hosted backend reports Supabase, not the in-memory store.
- [ ] Authentication is required on `/mcp` outside local/test.
- [ ] CI typecheck/tests pass.
- [ ] CI Docker image build passes.
- [ ] Remote `smoke-mcp-chatgpt.sh` passes.
- [ ] ChatGPT discovers exactly the seven pilot tools.
- [ ] Normal-chat read test passes.
- [ ] Normal-chat write + read-after-write test passes.
- [ ] One final `Sasha Memory OS` registration remains.
- [ ] README / backlog are updated with acceptance date and evidence.

Do not mark M6 complete solely because the code or app registration exists; remote read/write evidence is required.

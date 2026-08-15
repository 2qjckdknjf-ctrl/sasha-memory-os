# M6 — ChatGPT MCP closeout

## Goal

Connect ChatGPT to the canonical Sasha Memory OS through one final registration named **Sasha Memory OS**, with the restricted `chatgpt` MCP profile and the dedicated Supabase backend.

M6 supports two capability modes:

- **Mode A — MCP read + write** when the active ChatGPT account/workspace permits custom MCP write actions.
- **Mode B — MCP read + Web/HTTP write fallback** when ChatGPT exposes only read/fetch actions. Mode B is an accepted M6 fallback; do not misclassify a ChatGPT product-plan restriction as a Memory OS backend failure.

For private development/testing, ChatGPT may connect to either a reachable remote MCP endpoint or an OpenAI Secure MCP Tunnel when that feature is available to the account/workspace. A stable public HTTPS endpoint remains the preferred durable deployment and is required before treating the service as independently reachable without a tunnel.

## Runtime contract

The API process serves both the HTTP API and Streamable HTTP MCP endpoint:

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

The `chatgpt` profile must expose exactly:

1. `memory.search`
2. `memory.get`
3. `context.project`
4. `capture.text`
5. `memory.store_decision`
6. `handoff.create`
7. `memory.set_status`

Owner/ops tools such as OAuth, connector administration, embeddings, consolidation, outbox operations, and extraction must not be exposed by this profile.

If ChatGPT itself restricts write actions, the server may still advertise the approved seven-tool profile; acceptance must record which actions the active ChatGPT account actually permits.

## Pre-deploy validation

The image must build before any hosted rollout:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm audit --audit-level=critical
docker build -f apps/api/Dockerfile -t memory-os-api:m6 .
```

CI must run the same build gate so workspace-packaging regressions are caught before deployment.

### Repository-side evidence — 2026-08-15

GitHub Actions CI run `31877937594` passed the complete repository-side M6 gate on the PR branch:

- typecheck — PASS
- full test suite + golden retrieval/security tests — PASS
- critical dependency audit — PASS (`No known vulnerabilities found`)
- hosted API Docker image build — PASS
- production-like container starts with `MEMORY_OS_ENV=staging`, `MEMORY_OS_MCP_PROFILE=chatgpt`, `MEMORY_OS_REQUIRE_API_AUTH=1` — PASS
- unauthenticated `POST /mcp` is rejected with HTTP `401` — PASS
- authenticated MCP health / initialize — PASS
- exact seven-tool ChatGPT allowlist — PASS
- `memory.search` — PASS
- `memory.store_decision` — PASS
- `memory.get` of the stored decision — PASS
- unique-marker read-after-write search — PASS

This CI runtime deliberately uses the in-memory backend because repository CI has no production Supabase secrets. It proves packaging, profile isolation, auth enforcement, MCP protocol behavior, and the read/write loop, but it does **not** replace the required live Supabase/ChatGPT acceptance.

## Connection options

### Option 1 — durable HTTPS host (preferred)

The repository keeps Fly.io scaffolding in `fly.toml`. The selected host must terminate HTTPS and run the API with the restricted ChatGPT profile.

Set runtime secrets only in the host secret store. Do not pass secret values into repository files, PR comments, logs, or documentation.

The current Fly alpha configuration uses `min_machines_running=0`; this may introduce cold starts. Before calling the endpoint production-grade, either keep capacity warm or explicitly accept the latency tradeoff.

### Option 2 — Secure MCP Tunnel (private validation)

When the ChatGPT workspace/account provides Secure MCP Tunnel, it can be used to validate a private/local MCP service without opening public ingress. Treat this as a development/private connectivity path, not as proof that an independently hosted public endpoint exists.

Whichever option is used, the acceptance evidence must identify the exact connection method and endpoint/tunnel identity without recording secrets.

## Remote/backend smoke

For a directly reachable HTTPS host:

```bash
MEMORY_OS_API_BASE_URL=https://HOST \
MEMORY_OS_API_SECRET='***' \
./scripts/smoke-mcp-chatgpt.sh
```

Expected backend sequence:

1. `/mcp/health` returns `ok: true`, `profile: chatgpt`, backend `supabase`.
2. `GET /mcp` returns `405`.
3. `initialize` succeeds.
4. `tools/list` returns only the seven approved tools.
5. `memory.search` succeeds with profile defaults.
6. Direct MCP `memory.store_decision` succeeds at the backend level.
7. `memory.get` returns the written decision.
8. A search for the unique write marker returns the new decision (read-after-write).

The direct backend write test proves that Memory OS itself supports the write path even if the active ChatGPT plan later blocks invoking write actions from ChatGPT UI.

## ChatGPT registration and capability probe

Create or update one development registration:

- Name: `Sasha Memory OS`
- Connection: direct MCP URL ending in `/mcp`, or Secure MCP Tunnel when used for private validation
- Authentication: configured outside the repository; never store the bearer secret in docs

Perform the first acceptance on **ChatGPT web**, because custom MCP/developer-mode feature availability is controlled by the ChatGPT account/workspace and can differ by surface.

Then run this capability probe from a normal ChatGPT conversation:

1. `memory.search` for a known memory with `pack_context=true`.
2. `memory.get` for one returned memory.
3. `context.project` for the pilot project.
4. Attempt `memory.store_decision` with a unique idempotency key.
5. If the ChatGPT UI permits the write, search for the unique decision and verify read-after-write (**Mode A PASS**).
6. If the ChatGPT UI does not permit custom MCP write actions but the backend smoke write passed, record **Mode B ACCEPTED** and verify the corresponding write through the Web/HTTP fallback.
7. Run `capture.text` only when the active ChatGPT capability permits write actions; otherwise validate capture through the accepted Web/HTTP path.

Do not weaken server-side ACL/auth just to make a plan-limited ChatGPT write action work.

## Duplicate registration cleanup

Do not remove old registrations until the final `Sasha Memory OS` registration passes the applicable capability mode.

After acceptance:

- Keep: `Sasha Memory OS`
- Remove: `Sasha Memory OS Pilot`
- Remove: `Sasha MOS 27772`

Record the final registration identity/technical ID if the ChatGPT UI exposes one. Never invent it in repository files.

## M6 exit criteria

M6 is complete only when all applicable items are true:

- [ ] A private tunnel or durable HTTPS connection to the MCP service is working.
- [ ] If durable hosting is selected, HTTPS endpoint is stable and documented without secrets.
- [ ] Live runtime uses `MEMORY_OS_MCP_PROFILE=chatgpt`.
- [ ] Live backend reports Supabase, not the in-memory store.
- [ ] Authentication is required on live `POST /mcp` outside local/test.
- [x] CI typecheck passes.
- [x] CI tests pass.
- [x] CI critical dependency audit passes.
- [x] CI hosted API Docker image build passes.
- [x] CI production-like MCP auth gate passes.
- [x] CI exact ChatGPT seven-tool allowlist passes.
- [x] CI MCP write/get/read-after-write loop passes.
- [ ] Backend MCP smoke passes against the chosen live connection and Supabase backend.
- [ ] ChatGPT discovers the expected restricted tool surface.
- [ ] Normal-chat read test passes.
- [ ] Capability is recorded as either **Mode A PASS** or **Mode B ACCEPTED**.
- [ ] For Mode A: ChatGPT write + read-after-write passes.
- [ ] For Mode B: live backend write passes and Web/HTTP write fallback is verified.
- [ ] Exactly one final `Sasha Memory OS` registration remains.
- [ ] README / backlog are updated with acceptance date, capability mode, connection method, and evidence.

Do not mark M6 complete solely because code, a tunnel, a hosted URL, or a ChatGPT registration exists. Live retrieval evidence is mandatory; write evidence must be collected at the Memory OS backend and through ChatGPT itself whenever the active ChatGPT capability allows it.

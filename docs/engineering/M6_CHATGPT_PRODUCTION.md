# M6 — ChatGPT MCP closeout

## Goal

Connect ChatGPT to the canonical Sasha Memory OS through one final registration named **Sasha Memory OS**, with the restricted `chatgpt` MCP profile and the dedicated Supabase backend.

M6 supports two capability modes:

- **Mode A — MCP read + write** when the active ChatGPT account/workspace permits custom MCP write actions.
- **Mode B — MCP read + Web/HTTP write fallback** when ChatGPT exposes only read/fetch actions. Mode B is an accepted M6 fallback; do not misclassify a ChatGPT product-plan restriction as a Memory OS backend failure.

## Current state — 2026-08-15

**Backend/hosting gate: PASS. ChatGPT product-side acceptance: MODE A PASS.**

Final ChatGPT development registration:

- Name: `Sasha Memory OS`
- App ID: `asdk_app_6a8075f4f4088191bf10606929d0ab79`
- Version ID: `asdk_app_v_6a8075f4f418819180efe5d34f39464a`
- Authentication: Supabase OAuth 2.1 with dynamic client registration
- Acceptance date: 2026-08-15
- Closeout PR: [#2](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/2), merged as `8cbe8502e27b31a685b8c5b384b55bbd913de709`

The durable M6 endpoint is implemented as the Supabase Edge Function `memory-mcp` in the dedicated `sasha-memory-os` project (`vpxblcxsvlylqyldiuwr`). The Edge adapter exposes Streamable HTTP MCP over public HTTPS, reports the Supabase backend, enforces the restricted `chatgpt` profile, validates ChatGPT OAuth access tokens, and retains the existing API-secret boundary for legacy callers.

Canonical public base (no secret):

```text
https://vpxblcxsvlylqyldiuwr.supabase.co/functions/v1/memory-mcp
```

Canonical MCP URL:

```text
https://vpxblcxsvlylqyldiuwr.supabase.co/functions/v1/memory-mcp/mcp
```

The previous/legacy `MEMORY_OS_API_BASE_URL` route is **not** the canonical M6 endpoint; its `/mcp/health` still returns 405 and must not be used for final ChatGPT registration.

## Runtime contract

The durable Edge adapter serves:

- `GET .../memory-mcp/health` or `GET .../memory-mcp/mcp/health`
- `GET .../memory-mcp/mcp` → `405`
- `POST .../memory-mcp/mcp` → JSON-RPC MCP

The repository API container still supports the same `/mcp` contract for local/staging validation.

Required logical configuration:

```text
MEMORY_OS_MCP_PROFILE=chatgpt
MEMORY_OS_API_SECRET=...
MEMORY_OS_CHATGPT_SUBJECT_ID=33333333-3333-4333-8333-333333333302
MEMORY_OS_DEFAULT_WORKSPACE_ID=11111111-1111-4111-8111-111111111111
# MEMORY_OS_DEFAULT_PROJECT_ID is intentionally ignored; writes must pass explicit project_id
```

Never commit real secret values.

## Authentication boundary

The Supabase function is deployed with platform `verify_jwt=false` intentionally because MCP discovery must remain public and the function implements the protected-resource/OAuth challenge itself. This does **not** make the MCP read/write path anonymous:

1. `initialize`, `ping`, and `tools/list` expose metadata only and carry no private memory content;
2. tool calls require a valid Supabase OAuth access token or the legacy Memory OS API secret;
3. OAuth JWT issuer, expiry, client ID, audience, live user, and the private owner email allowlist are validated by the Edge Function;
4. the legacy secret is validated through the existing database API-secret boundary;
5. an invalid or absent credential is rejected with an MCP OAuth challenge;
6. authenticated tool calls still execute through the existing ACL-aware Supabase RPC surface.

The public health endpoint carries no memory content and no secret.

## Allowed ChatGPT tools

The `chatgpt` profile exposes exactly:

1. `memory.search`
2. `memory.get`
3. `context.project`
4. `capture.text`
5. `memory.store_decision`
6. `handoff.create`
7. `memory.set_status`

Owner/ops tools such as OAuth, connector administration, embeddings, consolidation, outbox operations, and extraction are not exposed by this profile.

If ChatGPT itself restricts write actions, the server may still advertise the approved seven-tool profile; acceptance must record which actions the active ChatGPT account actually permits.

## Repository-side evidence — 2026-08-15

GitHub Actions run `31890725293` passed the repository and live M6 gate:

- typecheck — PASS
- full test suite + golden retrieval/security tests — PASS
- critical dependency audit — PASS (`No known vulnerabilities found`)
- hosted API Docker image build — PASS
- production-like local container with `chatgpt` profile — PASS
- unauthenticated local `POST /mcp` → 401 — PASS
- local MCP initialize + exact seven-tool allowlist — PASS
- local search/write/get/read-after-write — PASS
- authenticated live Supabase Edge smoke — PASS

## Live Supabase Edge evidence — 2026-08-15

CI run `31890725293` used the repository's existing protected `MEMORY_OS_SUPABASE_URL` and `MEMORY_OS_API_SECRET` secrets and executed the same smoke script against the deployed Edge Function.

Observed evidence:

1. unauthenticated private `tools/call` returned an MCP error with `mcp/www_authenticate`; public `initialize` / `tools/list` remained available for discovery;
2. live health returned:

```json
{"ok":true,"service":"memory-os-mcp","backend":"supabase","profile":"chatgpt","transport":"streamable-http","adapter":"supabase-edge"}
```

3. `GET /mcp` → `405`;
4. `initialize` negotiated protocol `2025-03-26`;
5. `tools/list` returned exactly the seven approved ChatGPT tools;
6. live `memory.search` returned real Supabase memories;
7. live `memory.store_decision` created a real decision;
8. live `memory.get` returned that decision with backend `supabase`;
9. unique-marker read-after-write search found the new decision;
10. smoke ended with `m6_edge_smoke=pass`.

This proves the Memory OS backend itself supports the complete M6 read/write loop over durable public HTTPS.

## Deployment

The canonical durable deployment is now Supabase Edge Function `memory-mcp`.

Source:

```text
supabase/functions/memory-mcp/index.ts
```

Reproducible deployment helper:

```bash
./scripts/deploy-memory-mcp.sh
```

The repository keeps the older full API/Fly scaffolding for other workloads, but it is no longer required to prove the ChatGPT MCP transport itself.

## Remote/backend smoke

For the durable Edge host:

```bash
MEMORY_OS_API_BASE_URL=https://vpxblcxsvlylqyldiuwr.supabase.co/functions/v1/memory-mcp \
MEMORY_OS_API_SECRET='***' \
./scripts/smoke-mcp-chatgpt.sh
```

Expected sequence:

1. `/mcp/health` returns `ok: true`, `profile: chatgpt`, backend `supabase`.
2. `GET /mcp` returns `405`.
3. `initialize` succeeds.
4. `tools/list` returns only the seven approved tools.
5. `memory.search` succeeds with profile defaults.
6. Direct MCP `memory.store_decision` succeeds at the backend level.
7. `memory.get` returns the written decision.
8. A search for the unique write marker returns the new decision.

This sequence is now automated in CI and passed on run `31890725293`.

## ChatGPT registration and capability probe

The accepted development registration is:

- Name: `Sasha Memory OS`
- MCP URL: `https://vpxblcxsvlylqyldiuwr.supabase.co/functions/v1/memory-mcp/mcp`
- Authentication: Supabase OAuth 2.1 / OIDC with PKCE and dynamic client registration
- Consent UI: `https://2qjckdknjf-ctrl.github.io/sasha-memory-os/`

Perform acceptance on ChatGPT web first because custom MCP/developer-mode feature availability can differ by account/workspace and client surface.

Then run this capability probe from a normal ChatGPT conversation:

1. `memory.search` for a known memory with `pack_context=true`.
2. `memory.get` for one returned memory.
3. `context.project` for the pilot project.
4. Attempt `memory.store_decision` with a unique idempotency key.
5. If ChatGPT permits the write, search for the unique decision and verify read-after-write (**Mode A PASS**).
6. If ChatGPT does not permit custom MCP write actions but backend smoke has passed, record **Mode B ACCEPTED** and retain Web/HTTP for writes.
7. Validate `capture.text` through ChatGPT only when write actions are available; otherwise validate it through the accepted Web/HTTP path.

Do not weaken server-side ACL/auth just to make a plan-limited ChatGPT write action work.

## ChatGPT acceptance evidence — 2026-08-15

ChatGPT Scan Tools returned exactly these seven actions:

1. `memory.search`
2. `memory.get`
3. `context.project`
4. `capture.text`
5. `memory.store_decision`
6. `handoff.create`
7. `memory.set_status`

Normal-chat read acceptance:

- Query: `Порядок начала Slice 01`
- Memory ID: `66666666-6666-4666-8666-666666666601`
- Status: `verified`
- Confidence: `0.99`
- Context: `Slice 01 начинается после Product Design Audit PR #215.`
- Result: PASS

Normal-chat write/read-after-write acceptance:

- Tool: `memory.store_decision`
- Idempotency key: `chatgpt-m6-20260815T144111943Z-3446dbf1`
- Created Memory ID: `741dd042-6cb4-415a-b358-909127f2f65c`
- Created status: `verified`
- Read-after-write query: the exact idempotency key above
- Search result Memory ID: `741dd042-6cb4-415a-b358-909127f2f65c`
- Result: PASS; write and read-after-write IDs match

Capability classification: **Mode A PASS**.

Blockers found and resolved during acceptance:

1. Supabase Edge Functions rewrote the HTML consent response to `text/plain`; the consent page was moved to GitHub Pages.
2. Supabase rejected the consent-page origin until Auth `site_url` and `oauth_server_authorization_path` were aligned with the GitHub Pages URL.
3. The first ChatGPT read reached `memory.search` but the RPC boundary returned `unauthorized api secret`; PostgREST now exposes the service role primarily in `request.jwt.claims`, so migration `20260815144500_service_role_claims_compat.sql` added current and legacy claim compatibility. The repeated read then passed.

The acceptance run did not remove legacy registrations before the final app passed. The follow-up inventory then found one stale personal registration, `Sasha Mamory OS` (`asdk_app_6a7cae046c74819194fc59b8f18467b6`), still pointing at the expired `trycloudflare.com` endpoint. It was removed after Mode A acceptance, and a repeated `Sasha` catalog search returned exactly one personal registration: the connected final `Sasha Memory OS` app.

## Duplicate registration cleanup

Do not remove old registrations until the final `Sasha Memory OS` registration passes the applicable capability mode.

Cleanup result on 2026-08-15:

- Keep: `Sasha Memory OS`
- Removed: `Sasha Mamory OS` (`asdk_app_6a7cae046c74819194fc59b8f18467b6`)
- Final catalog inventory: exactly one personal Sasha registration

Record the final registration identity/technical ID if the ChatGPT UI exposes one. Never invent it in repository files.

## M6 exit criteria

- [x] Durable public HTTPS connection to the MCP service is working.
- [x] HTTPS endpoint is stable and documented without secrets.
- [x] Live runtime uses the restricted `chatgpt` profile.
- [x] Live backend reports Supabase, not the in-memory store.
- [x] Authentication is required on live private tool calls; metadata-only MCP discovery remains public.
- [x] CI typecheck passes.
- [x] CI tests pass.
- [x] CI critical dependency audit passes.
- [x] CI hosted API Docker image build passes.
- [x] CI production-like MCP auth gate passes.
- [x] CI exact ChatGPT seven-tool allowlist passes.
- [x] Backend MCP smoke passes against the live Supabase connection.
- [x] Backend MCP write/get/read-after-write passes against live Supabase.
- [x] Final ChatGPT registration named `Sasha Memory OS` points at the canonical Edge MCP URL.
- [x] ChatGPT discovers exactly the expected restricted tool surface.
- [x] Normal-chat read test passes.
- [x] Capability is recorded as **Mode A PASS**.
- [x] Actual ChatGPT write + read-after-write passes.
- [x] Mode B fallback is not required for this accepted ChatGPT connection.
- [x] Exactly one final `Sasha Memory OS` registration remains.
- [x] README / backlog are updated with acceptance date, capability mode, connection method, and evidence.

ChatGPT product-side acceptance and duplicate-registration cleanup are complete.

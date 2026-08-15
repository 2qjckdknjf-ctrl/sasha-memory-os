# Sasha Memory OS

Внешняя каноническая долговременная память, общая для ChatGPT, Cursor, ROMA и будущих агентов: единый Memory Core с ACL, temporal model и provenance.

## Документация

- [Техническое задание и roadmap (baseline v1.0)](docs/baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md)
- [Карта документов](docs/README.md)
- [M0 scope](docs/m0/SCOPE.md)
- [ADRs](docs/adr/README.md)
- [Environment matrix](docs/engineering/ENVIRONMENT_MATRIX.md)
- [Secrets policy](docs/engineering/SECRETS_POLICY.md)
- [RLS matrix](docs/engineering/RLS_MATRIX.md)
- [Demo slice](docs/engineering/DEMO_SLICE.md)
- [M6 ChatGPT production closeout](docs/engineering/M6_CHATGPT_PRODUCTION.md)

## Статус

**Dedicated Supabase live** — project `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, `eu-central-1`). Details: [docs/engineering/SUPABASE.md](docs/engineering/SUPABASE.md).

- WP-01…08 alpha + live Supabase RPCs
- OAuth HTTP exchange → shared encrypted vault (`MEMORY_OS_VAULT_BACKEND=supabase` default with Supabase URL)
- Vault-backed connector pulls, hybrid search (API/MCP), embeddings on capture/sync
- Re-embed: `POST /v1/memories/:id/embed` + batch `POST /v1/memories/embed-missing` + MCP `memory.embed` / `memory.embed_missing` + Web
- Consolidation worker + outbox enqueue (`api_enqueue_consolidation`) + `POST /v1/consolidation/run` + MCP `consolidation.run`
- Connector-sync / consolidation CLI ticks; optional `MEMORY_OS_WORKER_INTERVAL_MS` loop
- Golden retrieval harness: 200 hybrid ACL cases
- Web timeline / review / OAuth / consolidation controls: `apps/web`
- **M6 ChatGPT Mode A PASS (2026-08-15):** final `Sasha Memory OS` custom MCP app connected through Supabase OAuth 2.1; exact seven-tool scan, normal-chat read, `memory.store_decision`, and read-after-write all passed. The stale `Sasha Mamory OS` registration was removed; exactly one personal Sasha registration remains.

## Репозиторий

```bash
npx pnpm@9.15.9 install
npx pnpm@9.15.9 typecheck
npx pnpm@9.15.9 test
npx pnpm@9.15.9 dev:api
npx pnpm@9.15.9 dev:web
```

API uses Supabase RPCs + `MEMORY_OS_API_SECRET` (see `.env`). Web talks to API on `:8787`.

## Auth headers (demo)

- `x-subject-id` — subject UUID
- `x-actor-key` — `owner` / `chatgpt` / `cursor`
- `x-client-id` — `demo-owner` / `demo-chatgpt` / `demo-cursor`
- `x-auth-user-id` — Supabase Auth user UUID (after `POST /v1/auth/bind`)

OAuth broker: `POST /v1/oauth/start` → `POST /v1/oauth/callback` peeks state, exchanges code over HTTP when `CLIENT_ID`+`CLIENT_SECRET` are set, stores tokens in the shared vault (`MEMORY_OS_VAULT_*`, default backend `supabase`), and writes **vault refs only** to Postgres.

Workers:

```bash
npx pnpm@9.15.9 --filter @memory-os/worker-consolidation consolidate:once
npx pnpm@9.15.9 --filter @memory-os/worker-connector-sync sync:once
# loop: MEMORY_OS_WORKER_INTERVAL_MS=60000 npx pnpm@9.15.9 --filter @memory-os/worker-consolidation consolidate:loop
```

## Smoke (API)

```bash
# API running locally or remote; outside local/test set MEMORY_OS_API_SECRET
./scripts/smoke-api.sh
```

## Deploy API (alpha)

```bash
docker build -f apps/api/Dockerfile -t memory-os-api .
docker run --env-file .env -p 8787:8787 memory-os-api
# or: fly deploy  (see fly.toml; set secrets MEMORY_OS_*)
```

Then set GitHub secret `MEMORY_OS_API_BASE_URL` so `.github/workflows/worker-ticks.yml` can hit consolidation/sync/dead-letter ticks.

Outbox ops: `GET /v1/outbox/pending`, `POST /v1/jobs/dead-letter-stale`, `POST /v1/outbox/:id/publish`. MCP: `oauth.*`, `outbox.*`, `jobs.dead_letter_stale`.

MCP stdio / HTTP (Cursor, Claude, ChatGPT host path): [docs/engineering/MCP_CURSOR.md](docs/engineering/MCP_CURSOR.md)

```bash
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start:http   # :8790/mcp
# or POST http://localhost:8787/mcp on the API
```

Durable ChatGPT MCP transport is deployed as Supabase Edge Function `memory-mcp`; see [M6_CHATGPT_PRODUCTION.md](docs/engineering/M6_CHATGPT_PRODUCTION.md). Never commit the MCP/API secret.

OAuth redirect lands on Web `/oauth/callback` → API `/v1/oauth/callback`.  
Outside `local`/`test`, owner ops require `x-memory-os-api-secret` (or `MEMORY_OS_REQUIRE_API_AUTH=1`).

## Следующий шаг

1. ~~Alpha close + hosted ticks~~ — Edge `worker-ticks` v2 + GH `Worker ticks`
2. ~~KMS / HQ vector columns~~ — `supabase_vault` + `embedding_vector_hq(1536)`
3. ~~Full connector pull path~~ — GH `Worker node ticks` (vault sync + consolidation)
4. ~~RG0 artifact set~~ — checklist, risk, eval, backlog M1–M3, retention, DPIA, ChatGPT MCP ([RG0_CHECKLIST.md](docs/m0/RG0_CHECKLIST.md))
5. ~~HTTP MCP host path~~ — `POST /mcp` (+ standalone `:8790`); alpha ops mode **B** until A confirmed
6. ~~M1/M2/M3 alpha close-ups~~ — promote, observability, export, temporal, poison, Whisper STT, job UI
7. ~~M4 extraction preview/apply~~ — `/v1/extraction/preview|apply` + MCP/Web
8. ~~RG0 owner accept~~ — [OWNER_ACCEPT_2026-08-12.md](docs/m0/OWNER_ACCEPT_2026-08-12.md); MCP **B now**, **A preferred**
9. Fly full HTTP API — **deferred** (scaffold kept)
10. ~~M4 review UX~~ — selective extract apply, bulk review, MCP `extraction.run`
11. ~~M5 retrieval polish~~ — RRF hybrid, authority, context packer, temporal search (alpha)
12. ~~M6 backend/hosting~~ — durable Supabase Edge MCP + authenticated live Supabase search/write/get/read-after-write PASS (2026-08-15)
13. ~~Apply remote `search_rrf_temporal`~~ — applied 2026-08-12
14. ~~Web search pack-context UX~~ — agent citation block in control center
15. ~~M6 ChatGPT app acceptance and duplicate cleanup~~ — `Sasha Memory OS`, Supabase OAuth 2.1, exact seven-tool discovery, normal-chat read, write, and read-after-write: **Mode A PASS** (2026-08-15). Stale registration removed; merge PR #2.

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

MCP stdio (Cursor / Claude Desktop): see [docs/engineering/MCP_CURSOR.md](docs/engineering/MCP_CURSOR.md)

```bash
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start
```

OAuth redirect lands on Web `/oauth/callback` → API `/v1/oauth/callback`.  
Outside `local`/`test`, owner ops require `x-memory-os-api-secret` (or `MEMORY_OS_REQUIRE_API_AUTH=1`).

## Следующий шаг (план close demo-slice)

1. ~~Зафиксировать код (commit/PR)~~ — [PR #1](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/1)
2. **Deploy API** — `flyctl auth login` затем `./scripts/fly-deploy-api.sh` (нужен interactive login / `FLY_API_TOKEN`)
3. **Cron** — выставить GH `MEMORY_OS_API_BASE_URL` (после deploy); `MEMORY_OS_API_SECRET` уже в secrets репо
4. Harden prod — managed KMS / `supabase_vault`; optional pgvector dims >32 (`MEMORY_OS_OPENAI_EMBED_DIMS`)

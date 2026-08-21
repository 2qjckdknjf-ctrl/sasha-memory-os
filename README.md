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
- [CURRENT_STATE manifest](docs/engineering/CURRENT_STATE.json)
- [M14.1 baseline reconciliation](docs/engineering/M14_1_BASELINE.md)

## Статус

**Dedicated Supabase live** — project `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, `eu-central-1`). Details: [docs/engineering/SUPABASE.md](docs/engineering/SUPABASE.md).

Machine-readable snapshot: [docs/engineering/CURRENT_STATE.json](docs/engineering/CURRENT_STATE.json) (`m14.1-v1`).

- **Current milestone:** `M15.5-freshness-reconciliation` (watermarks + stale alerts; live E2E blocked)
- **Completed through:** M14 packs + M14.1 + M15.1–M15.5
- **Next slice:** `M15.6-deletion-revoke-lifecycle`
- **M6 ChatGPT Mode A PASS (2026-08-15):** final `Sasha Memory OS` custom MCP app connected through Supabase OAuth 2.1; exact seven-tool scan, normal-chat read, `memory.store_decision`, and read-after-write all passed. The stale `Sasha Mamory OS` registration was removed; exactly one personal Sasha registration remains.
- Core path live: WP-01…08 RPCs, vault OAuth, hybrid RRF retrieval, embeddings, consolidation/outbox/jobs, MCP, Control Center
- M10–M13 foundations merged (Drive/Gmail/Calendar policies, ROMA project-health, bounded agentic retrieval / consolidation / ranking)
- Writes require explicit `project_id`; ambiguous routing → `UNCLASSIFIED`; freshness alerts for stale source/snapshot/worker
- Known blockers: live connector/freshness E2E; remote M15.1 migration apply

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

Canonical order (do not skip): see [M14_1_BASELINE.md](docs/engineering/M14_1_BASELINE.md) and Memory OS title `SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21`.

1. ~~M14.1 baseline reconciliation~~ — CURRENT_STATE + README/main drift checks
2. ~~M15.1 source-event contract~~ — immutable normalized `source_events`, idempotency, adapters
3. ~~M15.2 connector orchestration~~ — pack + recovery tick (fixture PASS; live E2E BLOCKED)
4. ~~M15.3 project/entity routing~~ — fail-closed UNCLASSIFIED inbox, golden precision >=95%
5. ~~M15.4 canonicalization / dedupe / supersession~~ — authority matrix + source dedupe
6. ~~M15.5 freshness / reconciliation~~ — watermarks + stale alerts (live E2E BLOCKED)
7. **M15.6 deletion / revoke lifecycle**
8. M15.7–M15.8 then M16–M20; Fly API deferred

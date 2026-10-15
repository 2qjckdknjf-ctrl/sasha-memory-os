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
- [M19 Control Center governance](docs/engineering/M19_CONTROL_CENTER_GOVERNANCE.md)
- [M20.2 reliability and DR gate](docs/engineering/M20_SLICE_02_RELIABILITY_DR.md)
- [M20.3 performance and retrieval gate](docs/engineering/M20_SLICE_03_PERFORMANCE_RETRIEVAL.md)

## Статус

**Dedicated Supabase live** — project `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, `eu-central-1`). Details: [docs/engineering/SUPABASE.md](docs/engineering/SUPABASE.md).

Machine-readable snapshot: [docs/engineering/CURRENT_STATE.json](docs/engineering/CURRENT_STATE.json) (`m14.1-v1` schema, reconciled 2026-10-15).

- **Live operational milestone:** `M19_CONTROL_CENTER_GOVERNANCE_LIVE_PASS`; M20 production/GA closure is the next delivery slice
- **Contract packs completed through:** M19 (`m19-s01-v1`, owner Control Center governance)
- **Canonical Memory OS project UUID:** `44444444-4444-4444-8444-444444444402`
- **M6 ChatGPT Mode A PASS (2026-08-15):** ChatGPT-only; does not close shared-memory E2E
- **Bidirectional ChatGPT↔Cursor E2E PASS (2026-10-13):** real-session receipts, explicit project isolation, actor attribution verified
- **M17.5 production PASS:** explicit-project entity search, evidence inspector and bounded 2-hop traversal are live
- **M17.6 production PASS:** explicit graph search mode for HTTP + the seven-tool Edge MCP profile
- **M18.2 production PASS:** Edge v11, exact seven-tool discovery, bounded 1,800-token context and cross-project/handoff ACL live checks
- **M18.3 production PASS:** least-privilege canonical-project ACL, live worker job, three audited candidate findings and MCP read-after-write
- **M18.4 production PASS:** seven-tool-compatible approved writeback, deterministic dedupe, conflict stop, audited read-after-write and the ChatGPT/Cursor/ROMA same-state exit gate
- **M19 production PASS:** owner governance overview, routing inbox, job controls, cursor privacy, privilege boundaries and the server-secret-safe production Chrome gate passed from trusted `main`
- **M20.1 security implementation merged:** exhaustive RLS/RPC checks and threat model are live; leaked-password protection is enabled, while the stale GitHub Management API token still blocks a green automation receipt
- **M20.2 reliability/DR implementation:** daily backup inventory plus current-schema isolated restore and transactional retry/DLQ/replay/token-expiry drills are mandatory in CI
- **M20.3 performance/retrieval implementation:** frozen 200-case Recall@10 gate, M13 regression pack, 60-operation Supabase soak plus five bounded agentic probes, concurrent route/dedupe proof and steady-state read-only live Edge latency are mandatory in CI
- Core path live: WP-01…08 RPCs, vault OAuth, hybrid RRF retrieval, embeddings, consolidation/outbox/jobs, MCP, Control Center
- M10–M13 foundations merged (Drive/Gmail/Calendar policies, ROMA project-health, bounded agentic retrieval / consolidation / ranking)
- Apple: companion-required personal-source contracts complete; live device E2E still blocked
- Entity graph: durable projection + server-only search/inspector + evidence-bounded live traversal implementation
- Known blockers: real provider OAuth credentials/consent, Apple live device E2E, five non-terminal outbox events without a downstream publisher policy, stale GitHub Supabase Management token, vector-in-public advisor debt; Fly deferred. Terminal capture/ingest outbox backlog is zero.

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

Production recovery semantics: [M15_RUNTIME_RECOVERY.md](docs/engineering/M15_RUNTIME_RECOVERY.md).
Release security and repository governance: [M20_SECURITY_GOVERNANCE.md](docs/engineering/M20_SECURITY_GOVERNANCE.md).

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
7. ~~M15.6 deletion / revoke lifecycle~~ — tombstone/stop-sync convergence (fixture PASS; live BLOCKED)
8. ~~M15.7 autonomous capture policy~~ — auto-promote / reject / preview (live BLOCKED)
9. ~~M15.8 observability / SLOs~~ — M15 metric catalog (live dashboard BLOCKED)
10. M15 live E2E closure — fixture contract exists; production connector/runtime recovery remains **BLOCKED**
11. ~~M16.1 Apple capability feasibility matrix~~ — companion-required; no server iCloud scrape
12. ~~M16.2 Apple companion security foundation~~ — Keychain/device binding/encrypted transport (signing BLOCKED)
13. ~~M16.3 iCloud Drive / Files~~ — selected-scope metadata-first (live picker BLOCKED)
14. ~~M16.4 Photos~~ — metadata-only default; no silent bulk analysis (PhotoKit BLOCKED)
15. ~~M16.5 Notes / Reminders / Contacts~~ — selected-source typed mappings (EventKit/Contacts BLOCKED)
16. ~~M17.1 Entity graph foundation~~ — classes/edges/merge policy (live graph BLOCKED)
17. ~~M17.2 Entity resolution~~ — cross-source signals; golden >=95% (live E2E BLOCKED)
18. ~~M17.3 Graph-aware retrieval~~ — bounded traversal + hybrid fusion (live graph DB BLOCKED)
19. ~~P0 bidirectional ChatGPT↔Cursor shared memory~~ — live real-session receipts **PASS** (2026-10-13)
20. ~~M15 production runtime remediation~~ — outbox/runtime recovery PASS; real provider OAuth live E2E remains blocked
21. ~~M17.4 Entity migration backfill~~ — durable additive graph projection; production acceptance PASS
22. ~~M17.5 graph inspector + live graph E2E~~ — implementation, mandatory ephemeral proof and production acceptance PASS
23. ~~M17.6 graph/hybrid fusion + evaluations~~ — production Edge v9 and live graph/fallback/temporal acceptance PASS
24. ~~M18.1 Cursor bootstrap contract~~ (`m18-s01-v1`) — always-on rule, session hook, live bootstrap workflow, and automatic milestone read-after-write PASS
25. ~~M18.2 project context pack~~ (`m18-s02-v1`) — explicit-project API/MCP pack, migration, Edge v11 and authenticated 1,800-token live acceptance PASS; Memory OS receipt `9ac3fb2e-95de-42aa-aa34-e9954dc0228c`
26. ~~M18.3 ROMA integration~~ (`m18-s03-v1`) — shared context consumption, audited/deduplicated QA + release-risk outcomes, release evidence and candidate-only production read-after-write PASS; Memory OS receipt `ea0746e7-6557-4c66-b017-005e3c06f157`
27. ~~M18.4 ChatGPT automatic writeback policy~~ (`m18-s04-v1`) — production Edge v12 create/dedupe/conflict/read-after-write PASS; cross-client M18 exit gate PASS; Memory OS receipt `b664431d-7e33-49f3-bd3b-27dbb24150f0`
28. ~~M19 Control Center governance completion~~ (`m19-s01-v1`) — production migration, privilege checks, reversible routing probe and trusted-main Chrome E2E PASS; superseding Memory OS receipt `4376487c-d83f-42d1-bc1d-2d900baf2a30`
29. **M20 security, reliability/DR, performance, privacy, release engineering and final GA evidence** — M20.1/M20.2 landed; M20.3 is in acceptance; final closure remains open

## AI разборы 2026-10-13

[Сверка рекомендаций с существующими функциями](docs/AI_DIGEST_RECONCILIATION_2026-10-13.md) и [действующий innovation backlog](docs/AI_INNOVATION_BACKLOG_2026-09-08.md). Снача M15 production runtime recovery; новые требования к handoff/redaction/recall quality не снимают current live blockers.

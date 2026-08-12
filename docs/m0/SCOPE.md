# M0 — Discovery, governance и security baseline

Источник: baseline §20.3, §2, §25, §26. Полный текст — [Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md](../baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md).

## Статус артефактов

**WP-01 landed** in-repo: [ADR-001..005](../adr/README.md), monorepo skeleton (§4.4), CI smoke, [environment matrix](../engineering/ENVIRONMENT_MATRIX.md), [secrets policy](../engineering/SECRETS_POLICY.md).

**WP-02…08 alpha slice landed** (local + live Supabase): see [DEMO_SLICE.md](../engineering/DEMO_SLICE.md), [RLS_MATRIX.md](../engineering/RLS_MATRIX.md), [SUPABASE.md](../engineering/SUPABASE.md).

**WP-04 capture alpha landed**: `/v1/capture/text` + `/v1/capture/document` (TXT/PDF/DOCX extract) → quarantine artifact + SHA-256 + ingest job + chunks + candidate memory (remote RPCs + Web control surface).

**Subject + Connections control-plane alpha**: resolve via `x-subject-id` / `x-actor-key` / `x-client-id`; connection upsert + status (connect/reauth/revoke stubs); MCP `capture.text` + connection tools.

**WP-07 harness**: `tests/eval/golden_retrieval.*` — 200 ACL-aware hybrid retrieval cases.

**OAuth broker + Auth bind alpha**: `connector_secrets` / `oauth_states`, `/v1/oauth/start|callback` + MCP `oauth.start` / `oauth.callback` (peek → HTTP exchange → shared vault; refs only in DB), `/v1/auth/bind` + `x-auth-user-id` resolve; Web Auth panel binds session → subject. Outbox ops: `GET /v1/outbox/pending`, `POST /v1/jobs/dead-letter-stale` (+ Web Load outbox / Dead-letter; MCP `outbox.list_pending` / `jobs.dead_letter_stale`). Deploy: `apps/api/Dockerfile` + `fly.toml`.

**OCR + connector-sync alpha**: OCR engines; vault-backed pulls for GitHub/Drive/Gmail/Calendar (`MEMORY_OS_CONNECTOR_PULL_MODE`, DB `vaultRef` on enqueue, token refresh on expiry) → capture; MCP stdio gateway + capture/sync/oauth/outbox tools; OAuth HTTP exchange into shared encrypted vault + Web `/oauth/callback`; embeddings on capture/sync with `EMBED_STRICT` + owner re-embed (`POST /v1/memories/:id/embed` / MCP `memory.embed` / Web); hybrid search; consolidation + idempotent connector outbox; HTTP API secret on owner ops outside local; golden = 200; Dockerfile/`fly.toml`/GH worker-ticks + `scripts/smoke-api.sh`.


RG0 **owner-accepted 2026-08-12** — [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md), [RG0_CHECKLIST.md](./RG0_CHECKLIST.md).

## Цель

Превратить концепцию в измеряемый scope и снять внешние блокеры до начала platform/code bootstrap.

## Exit gate: RG0

- [x] Нет неизвестного внешнего dependency, которое делает M6/M9/M11 невозможным — see [RISK_REGISTER.md](./RISK_REGISTER.md).
- [x] Owner принимает V1 / OUT границы (ниже) + checkboxes в RG0 docs — [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md).
- [x] Artifacts: scope (this file), risk register, architecture (ADRs + engineering), [EVAL_PLAN.md](./EVAL_PLAN.md), [BACKLOG_M1_M3.md](./BACKLOG_M1_M3.md).

## Работы M0

- Подтвердить тариф/доступ ChatGPT custom MCP.
- Определить hosting region, retention и data classes.
- Зафиксировать pilot projects / sources / volumes.
- Создать ADR-001 canonical memory, ADR-002 event+projection, ADR-003 storage modes (и связанные ADR в WP-01).
- Threat model и initial DPIA / privacy review.
- Выбрать baseline embedding / LLM / OCR adapters без lock-in.
- Собрать 100–200 golden retrieval questions и forbidden-access cases.
- UX flows: connections, review, correction, handoff.

## V1 входит

- Единая память для ChatGPT, Cursor, ROMA и будущих агентов.
- Memory Core, event store, temporal memory, provenance и версии.
- Facts, preferences, ideas, decisions, tasks, events, entities, links, project state, handoff.
- Supabase / PostgreSQL, pgvector, FTS, Storage.
- Hybrid / structured retrieval и ограниченный agentic retrieval.
- MCP Gateway и HTTP API.
- Web/PWA control center.
- Connector Platform / SDK и reference connectors: GitHub, Google Drive, Gmail, Google Calendar.
- Apple companion (iCloud Drive selection, Photos, Share Extensions).
- ACL, RLS, privacy, audit, retention, export, backups.

## OUT для V1

- Скрытое или неограниченное сканирование всего iCloud.
- Автономные опасные действия во внешних системах без scope и подтверждения.
- Сохранение каждого сообщения как вечной активной памяти.
- Копирование целиком всех внешних сервисов «на всякий случай».
- Knowledge graph как единственный способ поиска.
- Enterprise billing, публичный marketplace коннекторов, массовый multi-tenant SaaS.
- Замена GitHub / Gmail / Calendar / Drive / Photos как primary source of truth.
- Обещание полного write-доступа ChatGPT там, где custom MCP write недоступен.

## Открытые решения (§26) — не блокируют baseline

- [x] ChatGPT MCP — **B now**, **A preferred** when write MCP available — [CHATGPT_MCP_PLAN.md](./CHATGPT_MCP_PLAN.md).
- [x] Embedding model — adapter `stub|noop|openai` + versioned `embedding_engine` / dims 32|1536 (owner picks prod default).
- [x] LLM для extraction — adapter `stub|fixture|openai` + `POST /v1/extraction/preview` / MCP `extraction.preview` (rerank LLM later).
- [x] OCR / transcription adapters — OCR + `stub|fixture|openai` Whisper.
- [x] Queue implementation — Postgres outbox + `processing_jobs` (V1 alpha).
- [x] Data region — `eu-central-1` accepted ([DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md)).
- [x] Полный mailbox / Drive vs selected labels/files — **selected scopes** for V1.
- [x] Retention raw conversations — not default memory; see retention table.
- [x] Full Photos indexing — OUT for V1; selected / opt-in later.
- [x] Knowledge graph — after M12, not Core dependency.
- [x] Dangerous writes для агентов — none by default.

## Рекомендуемый первый demo slice

`manual decision → project state → MCP context → Cursor handoff → Web timeline`

Подтверждает ценность продукта раньше массового ingestion и внешних connectors.

## Следующие work packages

| WP | Название | Артефакты |
|---|---|---|
| WP-01 | Architecture and repo bootstrap | ADR-001..005, repository skeleton, CI, code owners, environment matrix, secrets policy |
| WP-02 | Database and RLS foundation | Migrations identity/projects/events/artifacts/audit, RLS matrix, policy tests, seed |
| WP-03 | Event and ingestion contracts | JSON Schemas, idempotency, queue/outbox, job lifecycle, traces |
| WP-04 | Manual capture and document processing | Upload/text/link API, quarantine, PDF/DOCX, OCR, chunks/evidence |
| WP-05 | Typed Memory API | Facts/ideas/decisions/tasks, revisions, provenance, conflict/supersession |
| WP-06 | Project state and handoff | State projection, sessions, handoff schema/API, e2e fixture |
| WP-07 | Retrieval and evaluation | FTS/vector/hybrid, filters/RRF, golden dataset harness |
| WP-08 | MCP Gateway alpha | OAuth, tool schemas, Cursor test client, ChatGPT compatibility spike |

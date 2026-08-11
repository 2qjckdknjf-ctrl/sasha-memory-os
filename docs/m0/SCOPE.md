# M0 — Discovery, governance и security baseline

Источник: baseline §20.3, §2, §25, §26. Полный текст — [Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md](../baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md).

## Цель

Превратить концепцию в измеряемый scope и снять внешние блокеры до начала platform/code bootstrap.

## Exit gate: RG0

- Нет неизвестного внешнего dependency, которое делает M6/M9/M11 невозможным.
- Owner принимает V1 / OUT границы.
- Есть approved scope, risk register, architecture context, test/eval plan, backlog M1–M3.

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

- [ ] ChatGPT plan / workspace MCP capability (read-only + Web write fallback).
- [ ] Embedding model (adapter + versioned embeddings).
- [ ] LLM для extraction / rerank (provider-neutral contract).
- [ ] Queue implementation (Postgres-backed abstraction для V1).
- [ ] Data region / residency (отдельный EU region, если доступен).
- [ ] Полный mailbox / Drive vs selected labels/files.
- [ ] Retention raw conversations.
- [ ] Full Photos indexing (нет для V1; selected / opt-in beta).
- [ ] Knowledge graph (после M12, не dependency Core).
- [ ] Dangerous writes для агентов (никакие по умолчанию).

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

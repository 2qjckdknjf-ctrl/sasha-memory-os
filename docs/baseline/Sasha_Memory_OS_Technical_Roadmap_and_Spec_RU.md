# Sasha Memory OS

## Техническое задание и подробный roadmap разработки

**Версия:** 1.0  
**Статус:** baseline для проектирования и разработки  
**Дата:** 11 августа 2026  
**Владелец продукта:** Sasha  
**Основной стек:** Supabase / PostgreSQL / pgvector / FTS / Storage / TypeScript / MCP / Web-PWA / Swift

> **Ключевое решение.** Sasha Memory OS - это внешняя каноническая долговременная память, общей которой пользуются ChatGPT, Cursor, ROMA и будущие агенты. Клиенты не владеют отдельными несовместимыми копиями памяти. Они читают и записывают данные через единый Memory Core с обязательными правами доступа, временной моделью и provenance.

---

# 0. Управление документом

## 0.1 Назначение

Документ является одновременно:

- продуктовым техническим заданием;
- архитектурным baseline;
- планом поэтапной реализации;
- набором критериев приемки;
- основой для декомпозиции backlog, ADR, API-контрактов и тест-планов.

Если реализация расходится с данным документом, изменение должно быть оформлено как Architecture Decision Record (ADR) с описанием причины, влияния на безопасность, данные, совместимость и roadmap.

## 0.2 Приоритет требований

При конфликте требований применяется следующий порядок:

1. Защита данных, пользовательское согласие и наименьшие привилегии.
2. Корректность текущего состояния и сохранность истории.
3. Provenance и возможность объяснить происхождение ответа.
4. Совместимость клиентов и коннекторов.
5. Производительность и стоимость.
6. Удобство интерфейса.

## 0.3 Статусы требований

| Статус | Значение |
|---|---|
| MUST | Обязательно для указанной версии или release gate. |
| SHOULD | Должно быть реализовано, если нет документированного ограничения. |
| MAY | Допустимое расширение после выполнения обязательного объема. |
| OUT | Явно не входит в текущую версию. |

## 0.4 Основные допущения

- V1 проектируется для одного владельца и нескольких проектов, но схема данных сразу содержит `workspace_id` и не блокирует будущий multi-tenant режим.
- Объем пилота: до 100 000 внешних объектов, до 1 млн текстовых chunks, до 10 активных агентов и до 20 подключенных аккаунтов. Значения являются проектными целями для нагрузочного теста, а не коммерческими лимитами.
- Русский и английский языки обязательны. Другие языки должны сохраняться без потери, но качество лингвистической обработки подтверждается отдельно.
- Система размещается в отдельном Supabase-проекте и не смешивается с production-базами AISTROYKA, HiAir или других продуктов.
- Все длительности roadmap относительные и считаются от `T0` - утвержденного kickoff с доступной командой.

---

# 1. Резюме проекта

## 1.1 Проблема

ChatGPT, Cursor, ROMA и будущие агенты работают в разных сессиях и обычно не имеют надежного общего представления о том:

- какие решения уже приняты и почему;
- какое состояние проекта является текущим;
- что было сделано другим агентом;
- какие задачи открыты, заблокированы или отменены;
- какие документы, письма, репозитории и фотографии подтверждают вывод;
- какой старый факт уже заменен новым.

Обычная vector database решает только поиск похожих фрагментов. Она не определяет, что считать фактом, как хранить историю изменений, как разрешать конфликт, кто имеет право читать запись и где находится первоисточник.

## 1.2 Цель

Создать персональную Memory OS, которая:

- собирает события из разговоров, агентских сессий, файлов и подключенных сервисов;
- сохраняет необработанную историю для аудита;
- извлекает структурированные факты, идеи, решения, задачи и состояние проектов;
- различает актуальное утверждение, прошлую версию и спорное утверждение;
- предоставляет гибридный и agentic retrieval;
- безопасно обслуживает несколько AI-клиентов через MCP Gateway и API;
- позволяет подключать новые источники через универсальный Connector SDK;
- дает пользователю Web/PWA и Apple companion для контроля, исправления и удаления данных.

## 1.3 Определение успешного результата

Проект считается достигшим основной цели, когда выполняется сквозной сценарий:

1. В ChatGPT или Web записывается решение по проекту.
2. Решение появляется в общей памяти с источником, временем и областью доступа.
3. Cursor начинает сессию и получает актуальное состояние проекта без повторного объяснения.
4. Cursor завершает работу и создает handoff с commit, проверками и открытыми вопросами.
5. ChatGPT или ROMA читает тот же handoff и продолжает с корректного места.
6. Если позднее принято новое решение, старая запись остается в истории, но не выдается как current truth.
7. Любой ответ можно трассировать до разрешенного первоисточника.

## 1.4 Продуктовые показатели пилота

| Показатель | Цель private beta |
|---|---|
| Доля ответов о состоянии проекта с корректной ссылкой на источник | не менее 95% |
| Temporal precision для вопросов «что актуально сейчас» | не менее 95% на golden set |
| Успешные handoff между двумя клиентами без ручного пересказа | не менее 90% сценариев |
| Запросы, в которых ACL/RLS возвращает запрещенные данные | 0 |
| Повторная обработка одного события без создания дубля | 100% идемпотентно |
| Критические записи без provenance | 0 |
| Восстановление после тестовой потери базы и объектов | пройдено до public beta |

---

# 2. Границы продукта

## 2.1 Входит в целевой объем

- единая память для ChatGPT, Cursor, ROMA и будущих агентов;
- Memory Core, event store, temporal memory, provenance и версии;
- факты, предпочтения, идеи, решения, задачи, события, сущности, связи, project state и handoff;
- Supabase/PostgreSQL, pgvector, полнотекстовый поиск и Supabase Storage;
- текст, PDF, DOCX, изображения, фотографии, голосовые записи и ссылки;
- hybrid retrieval, structured retrieval и ограниченный agentic retrieval;
- дедупликация, обнаружение противоречий, supersession, correction и retraction;
- MCP Gateway и стабильный HTTP API;
- Web/PWA для поиска, контроля памяти, проектов, связей и аудита;
- универсальная Connector Platform и SDK;
- reference connectors: GitHub, Google Drive, Gmail, Google Calendar;
- native iOS/macOS companion для iCloud Drive, Photos/iCloud Photos и Share Extensions;
- ACL, RLS, privacy, audit, retention, export, backups и restore drills;
- мониторинг качества retrieval и коннекторов.

## 2.2 Не входит в V1

- скрытое или неограниченное сканирование всего iCloud пользователя;
- автономные опасные действия во внешних системах без отдельного scope и подтверждения;
- сохранение каждого сообщения как вечной активной памяти;
- копирование целиком всех внешних сервисов «на всякий случай»;
- обязательный knowledge graph как единственный способ поиска;
- enterprise billing, публичный marketplace коннекторов и массовый multi-tenant SaaS;
- замена GitHub, Gmail, Calendar, Drive или Photos как первичного источника истины;
- обещание полного write-доступа ChatGPT на тарифах, где custom MCP write недоступен.

## 2.3 Принцип source of truth

GitHub остается источником истины для кода и pull requests, Gmail - для писем, Calendar - для событий, Drive и iCloud - для файлов, Photos - для медиатеки. Memory OS хранит нормализованные события, извлеченные знания, индексы, summaries, связи и ссылки на оригиналы. Независимая копия оригинала создается только при политике хранения `archived`.

---

# 3. Пользователи и ключевые сценарии

## 3.1 Роли

| Роль | Основные права и задачи |
|---|---|
| Владелец | Полный контроль подключений, политик, исправлений, экспорта и удаления. |
| ChatGPT | Стратегия, анализ, планирование, чтение разрешенной памяти, запись решений и summaries. |
| Cursor | Инженерный контекст, repository/project state, события разработки и handoff; личные данные по умолчанию закрыты. |
| ROMA | Аудит, QA, автоматизация и findings в явно разрешенных проектах. |
| Future agent | Минимальный набор scopes под одну функцию. |
| Connector worker | Доступ только к своему аккаунту источника и ingestion contract. |
| Operator | Мониторинг, повтор jobs и восстановление без чтения содержимого, если это возможно. |

## 3.2 Обязательные пользовательские сценарии

### Сценарий A - начало агентской сессии

Клиент вызывает `session.start`, затем `context.project` и получает:

- текущий project state;
- последние активные решения;
- открытые и заблокированные задачи;
- последний handoff;
- изменения после предыдущей сессии;
- ссылки на подтверждающие источники.

### Сценарий B - запись решения

Пользователь или агент создает решение с формулировкой, rationale, проектом, датой вступления в силу и provenance. Система проверяет возможный дубль или конфликт, сохраняет событие и обновляет проекцию активных решений.

### Сценарий C - завершение работы и handoff

Агент фиксирует выполненное, артефакты, проверки, незавершенное, блокеры и recommended next. Handoff связывается с сессией, проектом, commit/PR и исходными событиями.

### Сценарий D - исправление памяти

Пользователь видит ошибочный факт, выбирает `Correct`, вводит правильное значение и причину. Исходная запись не переписывается бесследно: создается новая ревизия, старая получает статус `retracted` или `superseded`, а audit trail сохраняется.

### Сценарий E - подключение источника

Пользователь выбирает сервис, аккаунт, минимальные scopes, область данных и режим хранения `reference`, `indexed` или `archived`. Перед первой синхронизацией интерфейс показывает ожидаемый объем, чувствительность и действие при отзыве доступа.

### Сценарий F - запрос с текущей и исторической истиной

На вопрос «Что сейчас решено по Android?» retrieval сначала возвращает активное решение. На вопрос «Как решение менялось?» возвращается временная цепочка с supersession и источниками.

---

# 4. Принципы и архитектурные инварианты

## 4.1 Инварианты

- **Canonical memory:** одна система хранения и правил для всех клиентов.
- **Append first:** необработанные события и аудит добавляются, а не перезаписываются.
- **Derived state:** current state является версионируемой проекцией событий и структурированной памяти.
- **Provenance required:** критическое знание без подтверждающего source reference не становится `verified`.
- **Temporal by design:** система хранит время события, период действия знания и время его записи в базу.
- **Least privilege:** права источника и права агента независимы и пересекаются при каждом запросе.
- **Human control:** пользователь может увидеть, исправить, оспорить, экспортировать и удалить данные.
- **Idempotency:** повторная доставка события не создает новое знание или объект.
- **Source preservation:** исходный сервис остается первичным источником, если не выбран `archived`.
- **Async enrichment:** прием данных отделен от OCR, embeddings, LLM extraction и consolidation.
- **No implicit execution:** найденный документ является данными, а не доверенной инструкцией для агента.
- **Portable contracts:** Connector SDK, MCP и внутренние API версионируются и не зависят от одного LLM-провайдера.

## 4.2 Модульный монолит для V1

V1 SHOULD реализовываться как модульный монолит с отдельными worker-процессами, а не как набор ранних микросервисов. Границы модулей обязательны, но физическое разделение выполняется только при подтвержденной нагрузке или требованиях изоляции.

Рекомендуемые runtime-компоненты:

- API / Memory Gateway;
- MCP Gateway;
- ingestion worker;
- connector sync worker;
- extraction/consolidation worker;
- Web/PWA;
- native Apple companion;
- PostgreSQL/Supabase и Object Storage.

## 4.3 Высокоуровневая архитектура

![Высокоуровневая архитектура Sasha Memory OS](Sasha_Memory_OS_Architecture.png)

Потоки разделены на control plane и data plane:

- **Control plane:** connections, secrets, scopes, policies, schemas, jobs, health, audit.
- **Data plane:** source events, raw artifacts, extraction, memory records, indexes, retrieval и выдача контекста.

## 4.4 Рекомендуемая структура репозитория

```text
apps/
  api/
  mcp-gateway/
  web/
  apple-companion/
workers/
  ingestion/
  connector-sync/
  consolidation/
packages/
  domain/
  schemas/
  connector-sdk/
  retrieval/
  authz/
  provenance/
  observability/
connectors/
  github/
  google-drive/
  gmail/
  google-calendar/
  apple-bridge/
supabase/
  migrations/
  policies/
  functions/
tests/
  contracts/
  integration/
  retrieval-evals/
  security/
```

---

# 5. Доменная модель памяти

## 5.1 Четыре уровня памяти

| Уровень | Назначение | Примеры |
|---|---|---|
| Raw memory | Неизменяемые события и оригиналы для аудита и повторной обработки. | message, webhook, file version, mail event, transcript |
| Semantic memory | Устойчивые факты, предпочтения, идеи, решения и сущности. | технология проекта, решение, контакт, правило |
| Episodic memory | Что произошло в конкретное время и в какой последовательности. | session, commit, встреча, импорт документа |
| Working state | Актуальное операционное состояние проекта и следующий шаг. | current branch, PR, blockers, next actions |

Ни один уровень не заменяет другой. Raw memory обеспечивает доказуемость, semantic memory - полезное знание, episodic memory - историю, а working state - быстрый старт следующей сессии.

## 5.2 Типы структурированной памяти

### Fact

Утверждение о пользователе, проекте, продукте, системе или сущности. Обязательные поля: statement, subject/entity, confidence, validity, provenance и status.

### Preference

Устойчивое предпочтение пользователя или проекта. Для чувствительных предпочтений требуется явное подтверждение пользователя.

### Idea

Гипотеза или замысел, который еще не является решением. Имеет maturity: `captured`, `exploring`, `validated`, `rejected`, `promoted_to_decision`.

### Decision

Принятое решение с rationale, alternatives, decision maker, effective date и статусом. Решение MAY supersede другое решение.

### Task

Действие с owner, status, priority, due date, dependencies, source и связью с проектом/решением.

### Project state

Версионируемый snapshot текущего состояния: stage, active branch/PR, completed, in progress, blocked, next, risks, decisions и last verified at.

### Handoff

Передача контекста между агентами: from/to, session, completed, artifacts, validation, open items, blockers и recommended next.

### Entity and relationship

Человек, организация, проект, продукт, репозиторий, документ, сервис или место и типизированная связь между ними.

## 5.3 Общий envelope MemoryRecord

Все типизированные записи MUST содержать общий envelope:

| Поле | Требование |
|---|---|
| `id` | UUID; неизменяемый идентификатор. |
| `workspace_id` | Обязательная граница tenant/RLS. |
| `project_id` | Nullable; область проекта. |
| `memory_type` | fact, preference, idea, decision, task, event, state, handoff. |
| `title` / `content` | Человекочитаемое представление. |
| `status` | candidate, active, verified, disputed, superseded, retracted, deleted. |
| `importance` | Нормализованное значение 0..1 с объяснимыми правилами. |
| `confidence` | Уверенность 0..1; не заменяет статус проверки. |
| `sensitivity` | public, internal, personal, confidential, restricted. |
| `valid_from` / `valid_to` | Время действия утверждения в предметной области. |
| `observed_at` | Когда событие или утверждение было замечено источником. |
| `recorded_at` | Когда запись попала в Memory OS. |
| `superseded_by` | Ссылка на актуальную запись, если заменена. |
| `source_event_id` | Основное событие происхождения. |
| `created_by_subject` | Пользователь, агент или worker. |
| `schema_version` | Версия контракта. |
| `metadata` | JSONB только для расширений, не заменяющих обязательные колонки. |

## 5.4 Provenance

Provenance MUST быть first-class сущностью, а не произвольным полем текста. Минимальный набор:

- provider и connector account;
- external object ID и версия;
- canonical URL или Apple local/cloud identifier;
- source event ID;
- artifact ID и checksum;
- позиция в источнике: page, paragraph, chunk, message ID, timestamp или line range;
- actor/author, если доступен;
- observed_at и fetched_at;
- extraction method/model/version;
- confidence и review status.

Одна memory record MAY иметь несколько evidence links. Для `verified` решения или факта MUST существовать минимум одно разрешенное доказательство или явное подтверждение владельца.

## 5.5 Временная модель

Система MUST различать:

- **event time** - когда событие произошло;
- **valid time** - когда утверждение было истинно в предметной области;
- **system time** - когда версия была записана в базу.

Рекомендуется bitemporal подход: `valid_from/valid_to` плюс `recorded_at/replaced_at`. Исправление прошлой даты не должно менять историю системного времени.

Статусы актуальности:

| Статус | Поведение retrieval |
|---|---|
| active / verified | Может участвовать в current truth. |
| candidate | Выдается только с предупреждением или для review. |
| disputed | Не используется как однозначный факт. |
| superseded | Исключается из current truth, остается в history. |
| retracted | Показывается только в audit/history. |
| deleted | Недоступен обычному retrieval; обработан согласно deletion policy. |

## 5.6 Conflict, supersession и correction

Conflict Engine MUST поддерживать:

- exact duplicate по provider/external ID/version и content hash;
- near duplicate по entity, type, temporal overlap и semantic similarity;
- contradiction candidate по несовместимым значениям одного атрибута;
- stale knowledge по истекшему `valid_to` или более свежему authoritative source;
- explicit correction от пользователя;
- supersession chain без циклов.

Автоматическое правило MAY пометить конфликт, но не должно молча заменять важные решения. Высокозначимые изменения (`decision`, `preference`, `project_state`, restricted data) требуют детерминированного правила либо user review.

---

# 6. Логическая схема данных

## 6.1 Identity и access

| Таблица | Ключевое назначение |
|---|---|
| `workspaces` | Tenant boundary и настройки региона/retention. |
| `users` | Владелец и будущие участники. |
| `subjects` | Унифицированный principal: user, agent, service, connector. |
| `agents` | Клиент, версия, capabilities, trust level. |
| `roles` / `role_bindings` | Ролевые назначения. |
| `acl_entries` | Object/project/source-level grants и denies. |
| `api_clients` | MCP/API OAuth clients и service identities. |

## 6.2 Core memory

| Таблица | Ключевое назначение |
|---|---|
| `projects` | Проекты, aliases, repositories, статус. |
| `source_events` | Append-only журнал поступивших событий. |
| `memory_records` | Общий envelope и текстовое представление. |
| `facts` | Нормализованные subject-predicate-value утверждения. |
| `preferences` | Устойчивые предпочтения и область действия. |
| `ideas` | Идеи и maturity lifecycle. |
| `decisions` | Решения, rationale, alternatives, effective time. |
| `tasks` | Задачи, owner, status, dependency и deadlines. |
| `project_state_versions` | Версии working state с optimistic concurrency. |
| `handoffs` | Передача контекста между сессиями и агентами. |
| `entities` / `entity_aliases` | Канонические сущности и разрешение имен. |
| `relationships` | Типизированные связи с validity/provenance. |
| `memory_evidence` | Many-to-many связь памяти и источников. |
| `memory_conflicts` | Кандидаты конфликтов и результат resolution. |
| `memory_revisions` | История изменений представления записи. |

## 6.3 Documents и indexes

| Таблица | Ключевое назначение |
|---|---|
| `artifacts` | Оригиналы, версии, MIME, checksum, storage policy. |
| `documents` | Логический документ независимо от версии файла. |
| `document_versions` | Версия, parser, extraction status. |
| `document_chunks` | Иерархические chunks с offsets и ancestry. |
| `chunk_embeddings` | Embedding, provider/model/version/dimensions. |
| `link_snapshots` | Canonical URL, fetch time, content hash, HTTP metadata. |
| `media_derivatives` | Thumbnail, OCR, transcript, captions. |

Embeddings MUST храниться отдельно от основного текста, чтобы переиндексация новой моделью не изменяла каноническую запись. Unique key SHOULD включать `(chunk_id, embedding_model, model_version)`.

## 6.4 Connectors и jobs

| Таблица | Ключевое назначение |
|---|---|
| `connector_definitions` | Registry и версия manifest. |
| `connector_accounts` | Подключенный аккаунт и состояние auth. |
| `connector_scopes` | Разрешенные области провайдера. |
| `connector_secrets` | Ссылка на vault/KMS, без открытых токенов в БД. |
| `connector_cursors` | Incremental cursor/checkpoint по stream. |
| `external_objects` | Нормализованный внешний объект и версия. |
| `sync_jobs` / `sync_attempts` | Планирование, retry, статистика и ошибки. |
| `webhook_deliveries` | Delivery ID, signature status, payload hash, processing state. |
| `dead_letter_items` | События, исчерпавшие retry policy. |

## 6.5 Sessions, audit и operations

| Таблица | Ключевое назначение |
|---|---|
| `agent_sessions` | Начало/окончание сессии, client, project и version. |
| `session_events` | Действия агента внутри сессии. |
| `audit_log` | Кто, когда, к чему обращался и что изменил. |
| `access_log` | Read/search/fetch с outcome и policy decision. |
| `outbox_events` | Надежная публикация внутренних событий. |
| `processing_jobs` | OCR, parsing, embeddings, extraction, consolidation. |
| `quality_reviews` | Human review и evaluation verdicts. |

## 6.6 Обязательные ограничения базы

- Все пользовательские таблицы имеют `workspace_id NOT NULL` и включенный RLS.
- `source_events` уникален по `(connector_account_id, idempotency_key)` либо эквивалентному источнику.
- Supersession chain не содержит циклов; одна запись не supersede сама себя.
- `valid_to` больше `valid_from`, если обе даты заданы.
- Storage object checksum соответствует зарегистрированной версии.
- Записи audit/event store не изменяются прикладными ролями.
- Внешние IDs не считаются глобально уникальными без provider/account/collection.
- Все timestamps хранятся в UTC; исходная timezone сохраняется в metadata.
- Service role не используется из browser/mobile clients.

---

# 7. Хранение, индексы и резервное копирование

## 7.1 PostgreSQL и Supabase

Отдельный Supabase-проект MUST содержать:

- PostgreSQL как каноническую структурированную БД;
- `pgvector` для semantic search;
- PostgreSQL FTS с GIN indexes;
- Supabase Storage для originals и derivatives;
- Supabase Auth или совместимый OIDC provider;
- миграции схемы, RLS policies и database functions в version control.

## 7.2 Полнотекстовый поиск

FTS MUST поддерживать смешанный русский/английский контент. Baseline:

- generated `tsvector` columns для title, summary, body и entity names;
- разные веса A/B/C/D;
- GIN index;
- `websearch_to_tsquery` для пользовательских запросов;
- fallback на конфигурацию `simple` для смешанного или неизвестного языка;
- отдельные language-aware vectors MAY использоваться после оценки качества.

## 7.3 Vector search

- HNSW является baseline index после достижения объема, при котором sequential scan перестает выполнять SLO.
- Distance metric выбирается в соответствии с embedding model и фиксируется ADR.
- Размерность vector column не хардкодится до выбора production embedding model.
- Filtering по workspace/project/ACL/status/validity выполняется до выдачи результата.
- Re-embedding запускается версионируемой background job и допускает параллельное существование старого и нового индекса.

## 7.4 Supabase Storage

Рекомендуемые buckets:

| Bucket | Содержимое | Политика |
|---|---|---|
| `raw-events` | Большие raw payloads, если их нельзя хранить в БД. | private, short/defined retention |
| `artifacts` | Archived originals. | private, versioned keys |
| `derivatives` | OCR, thumbnails, previews, transcripts. | private, regenerable |
| `exports` | Пользовательские export packages. | private, expiring download |
| `quarantine` | Непроверенные uploads. | isolated, no retrieval |

Object key MUST включать workspace, artifact ID и version; исходное имя хранится как metadata и не используется как доверенный path.

## 7.5 Backup и disaster recovery

Database backup не считается backup всего продукта: резервные копии Supabase Database не восстанавливают удаленные объекты Storage. Поэтому обязательны два независимых контура:

- ежедневные database backups; для production SHOULD быть PITR;
- отдельное versioned/off-site копирование archived Storage objects и manifests.

Целевые показатели beta:

| Показатель | Цель |
|---|---|
| RPO базы | не более 15 минут при включенном PITR; иначе явно документированный daily RPO |
| RPO archived objects | не более 24 часов |
| RTO private beta | не более 8 часов |
| Restore drill | минимум ежеквартально и перед GA |

Каждый restore drill MUST проверять не только наличие строк, но также RLS, object checksums, embeddings/index rebuild и выборочную воспроизводимость provenance.

---

# 8. Universal ingestion pipeline

## 8.1 Общий поток

![Поток ingestion и формирования памяти](Sasha_Memory_OS_Ingestion_Flow.png)

Каждый источник проходит единый pipeline:

```text
capture -> validate -> quarantine -> hash/dedup -> raw event
        -> store/reference original -> extract/OCR/transcribe
        -> normalize -> chunk -> classify/entities
        -> memory candidates -> FTS/embeddings
        -> quality gate -> publish projections -> audit
```

Шаги выполняются идемпотентно. Ошибка enrichment не должна отменять факт приема события. Повторный запуск с тем же parser/model version не создает дубли.

## 8.2 Контракт приема

Минимальный `IngestionEnvelope`:

```json
{
  "schema_version": "1.0",
  "workspace_id": "uuid",
  "source": {
    "provider": "google_drive",
    "account_id": "uuid",
    "external_id": "file-id",
    "external_version": "opaque-version"
  },
  "event_type": "object.updated",
  "observed_at": "2026-08-11T08:00:00Z",
  "idempotency_key": "provider/account/object/version/event",
  "content": {
    "mime_type": "application/pdf",
    "reference": "storage-or-provider-reference",
    "checksum": "sha256:..."
  },
  "scope": {
    "project_id": "uuid",
    "sensitivity": "confidential",
    "storage_mode": "indexed"
  },
  "provenance": {}
}
```

## 8.3 Стадии и требования

### Capture and validate

- Проверить schema version, tenant, connector state и scope.
- Ограничить размер, MIME types, URL schemes и nested archives.
- Проверить webhook signature до parsing payload.
- Создать immutable source event и trace ID.

### Quarantine and safety

- Пользовательские файлы сначала попадают в isolated bucket.
- Архивы имеют лимит глубины, количества файлов и суммарного размера.
- Active content, macros и executable attachments не исполняются.
- Link fetcher имеет SSRF protection, DNS/IP revalidation, egress allowlist и лимит redirects.
- Извлеченный текст помечается как untrusted content для последующих LLM вызовов.

### Hash and dedup

- Exact content: SHA-256 original bytes.
- Logical version: provider version/etag/revision.
- Text fingerprint: normalized content hash.
- Near duplicate: optional MinHash/semantic similarity после exact checks.

### Extract and normalize

- Сохранить parser name/version и warnings.
- Сохранить иерархию: документ, section, paragraph/table, page и media timestamp.
- Нормализовать Unicode, но не терять original bytes.
- Не удалять даты, units, code symbols и IDs в процессе cleaning.

### Chunk and index

- Chunking SHOULD быть structure-aware, а не только по числу токенов.
- Chunk хранит parent section, neighboring chunks, offsets и provenance.
- Chunk size и overlap версионируются; baseline определяется retrieval evaluation.
- FTS может быть готов раньше embeddings; объект имеет независимые stage statuses.

### Extract memory candidates

- LLM extraction возвращает schema-validated JSON.
- Каждый candidate содержит evidence spans, confidence и proposed action.
- Low-confidence и high-sensitivity candidates идут в review queue.
- LLM не имеет права самостоятельно ставить `verified` без правила или user confirmation.

## 8.4 Текст и ручные заметки

- Быстрый capture MUST принимать plain text и Markdown.
- Пользователь может указать project, type, importance, sensitivity и `remember until`.
- Explicit commands `remember`, `decision`, `task` обходят generic classifier, но не provenance/audit.
- Clipboard capture MAY появиться в native companion после privacy review.

## 8.5 PDF

- Поддержать text PDF и scanned PDF.
- Для scanned PDF запускать OCR с page-level provenance.
- Извлекать metadata, headings, paragraphs и tables в меру надежности parser.
- Password-protected PDF требует пароль только в локальной пользовательской сессии; пароль не сохраняется.
- Значение page number в evidence соответствует отображаемой странице документа либо явно содержит physical page index.

## 8.6 DOCX

- Извлекать headings, paragraphs, lists, tables, hyperlinks, comments и tracked-change state, если parser это поддерживает.
- Сохранять порядок блоков и структурные IDs.
- Не считать удаленный tracked-change text актуальным без явного режима review history.
- Embedded files обрабатываются как отдельные artifacts только после safety checks.

## 8.7 Фото и изображения

Pipeline MAY создавать:

- EXIF metadata с privacy policy;
- OCR text;
- perceptual hash;
- thumbnail;
- visual caption и detected objects с model/version/confidence;
- face recognition только как отдельная opt-in функция, OUT для V1.

GPS metadata имеет sensitivity не ниже `personal` и по умолчанию не передается агентам.

## 8.8 Voice и audio

- Сохранять original audio согласно storage mode.
- Определять язык и создавать transcript с timestamps.
- При возможности разделять speakers, но не утверждать identity без подтверждения.
- Пользователь может редактировать transcript; correction создает новую revision.
- Memory extraction выполняется из подтвержденного или помеченного transcript с ссылкой на audio time range.

## 8.9 Links и web snapshots

- Сохранять canonical URL, fetch time, title, author/date, content hash и HTTP metadata.
- Поддержать `reference only` без копирования текста.
- Для `indexed` хранить очищенный snapshot и ссылку на оригинал.
- Повторный fetch создает version, если content hash изменился.
- Authenticated pages читаются только через разрешенный connector/browser context; credentials не передаются generic fetcher.

## 8.10 Job lifecycle

Статусы: `queued`, `running`, `succeeded`, `partial`, `retryable_failed`, `dead_letter`, `cancelled`.

Retry policy MUST учитывать тип ошибки, `Retry-After`, provider quotas и exponential backoff with jitter. Poison item после лимита попадает в dead letter с возможностью безопасного replay.

---

# 9. Memory Core и consolidation

## 9.1 Write paths

Система имеет три контролируемых пути записи:

| Путь | Пример | Уровень доверия |
|---|---|---|
| Explicit | Пользователь или агент вызывает `decision.record`. | Высокий, но проверяются scope и конфликт. |
| Extracted | Pipeline извлекает факт из письма или документа. | Candidate до правила/review. |
| Derived | Project state или summary рассчитывается из событий. | Зависит от входных records и projection version. |

## 9.2 Explicit memory write

Каждый write request MUST иметь:

- subject/actor;
- workspace и project scope;
- memory type;
- content или типизированный payload;
- provenance или явную отметку `user_asserted`;
- idempotency key;
- sensitivity;
- ожидаемую версию при update;
- reason для correction/supersession/delete.

API сначала возвращает durable write receipt, а embeddings и тяжелая extraction выполняются асинхронно.

## 9.3 Consolidation policy

Consolidation worker выполняет:

- объединение подтвержденных дублей;
- обновление entity aliases;
- связывание событий, решений и задач;
- формирование candidate conflicts;
- пересчет summaries и project state projections;
- снижение retrieval weight устаревших данных без удаления истории;
- re-verification записи при изменении/удалении источника.

Consolidation MUST быть воспроизводимой по versioned rules/models. Каждое изменение active state имеет link на входные records и consolidation run.

## 9.4 Project state

`project_state_versions` использует optimistic concurrency:

- клиент читает `state_version`;
- update передает expected version;
- конфликт обновления возвращает current state и diff;
- успешный update создает новую версию и audit event;
- state MAY быть пересчитан из событий, но user-pinned fields не перезаписываются автоматически.

Обязательные поля project state:

```text
stage
current_objective
active_repositories / branches / PRs
completed
in_progress
blocked
next_actions
active_decisions
risks
last_verified_at
evidence
```

## 9.5 Handoff

Handoff MUST быть коротким operational artifact, а не полным transcript:

```json
{
  "project": "AISTROYKA",
  "from_agent": "cursor",
  "session_id": "...",
  "completed": ["..."],
  "artifacts": [{"type": "commit", "ref": "abc123"}],
  "validation": [{"check": "tests", "result": "pass"}],
  "open_items": ["..."],
  "blockers": ["..."],
  "recommended_next": ["..."],
  "evidence": ["..."]
}
```

`session.finish` SHOULD предлагать handoff, если сессия изменила проект. Пустой optimistic handoff не создается: completion и validation должны быть подтверждаемы session events или источником.

## 9.6 Forget, delete и retraction

Операции разделяются:

- `retract` - утверждение неверно, но история нужна;
- `forget` - исключить из активной памяти и retrieval;
- `delete` - удалить данные по privacy request;
- `disconnect` - прекратить sync и применить выбранную retention policy;
- `purge` - физическое удаление после grace period и legal/backup policy.

Delete workflow MUST учитывать chunks, embeddings, derivatives, caches, exports, external references и backups. Пользователь получает deletion receipt с scope и ожидаемым сроком завершения.

---

# 10. Retrieval Engine

## 10.1 Цели

Retrieval обязан отвечать не только «что похоже», но и:

- что актуально на заданный момент;
- что относится к разрешенному проекту и агенту;
- какое утверждение подтверждено более надежным источником;
- как изменялась информация;
- какие доказательства можно вернуть клиенту;
- когда нужен live fetch из первичного источника.

## 10.2 Query planning

Query Planner классифицирует запрос:

| Класс | Предпочтительный путь |
|---|---|
| Exact entity/state | SQL/entity resolution/project state. |
| Keyword/ID | FTS + exact metadata filters. |
| Semantic question | Vector + FTS hybrid. |
| Current truth | Temporal/status filter + authoritative source ranking. |
| Historical change | Timeline/supersession chain. |
| Fresh external state | Live connector после policy check. |
| Multi-hop | Ограниченный agentic retrieval с budget. |

## 10.3 Hybrid pipeline

Baseline pipeline:

```text
authorize query
-> resolve workspace/project/entities/time intent
-> structured candidates (SQL)
-> FTS candidates
-> vector candidates
-> temporal/status/sensitivity filters
-> Reciprocal Rank Fusion
-> optional reranker
-> diversity/dedup
-> evidence expansion
-> context packing with citations
```

ACL/RLS применяется до попадания текста в модель и повторно проверяется при fetch evidence. Post-filter после retrieval не считается достаточной защитой.

## 10.4 Ranking features

Ranking SHOULD учитывать:

- lexical и vector relevance;
- exact project/repository/entity match;
- active/verified status;
- temporal validity на момент запроса;
- source authority и provenance quality;
- recency, если запрос о текущем состоянии;
- importance;
- user pinning;
- conflict/dispute penalties;
- diversity источников;
- freshness TTL для live data.

Вес каждого признака версионируется и оценивается на golden dataset.

## 10.5 Agentic retrieval

Agentic mode MAY выполнить несколько итераций: уточнить сущность, запросить timeline, сделать live fetch, найти evidence и проверить конфликт. Он MUST иметь:

- максимум шагов;
- time/token/cost budget;
- allowlist tools;
- запрет расширять scopes;
- trace всех запросов и результатов;
- безопасное завершение с сообщением о недостатке данных.

Agentic retrieval не может самовольно записывать новую verified memory. Write side является отдельным tool/action.

## 10.6 Ответ retrieval API

Минимальный response contract:

```json
{
  "answer_context": [{"text": "...", "record_id": "..."}],
  "current_truth": true,
  "as_of": "2026-08-11T00:00:00Z",
  "sources": [{"provider": "github", "reference": "..."}],
  "conflicts": [],
  "freshness": {"mode": "indexed", "fetched_at": "..."},
  "policy": {"scope": "project:AISTROYKA", "redactions": 0},
  "trace_id": "..."
}
```

Клиент обязан отличать source citation от модели-generated summary.

## 10.7 Retrieval evaluation

Golden dataset MUST содержать:

- exact facts;
- mixed Russian/English terms;
- code/commit/PR IDs;
- current vs superseded decisions;
- disputed facts;
- queries with no answer;
- forbidden data for each agent;
- cross-project ambiguity;
- live connector fallback;
- prompt injection inside documents.

Основные метрики: Recall@k, MRR/nDCG, temporal precision, provenance coverage, answer groundedness, refusal correctness, ACL leak rate и p95 latency.

---

# 11. MCP Gateway и клиентская интеграция

## 11.1 Назначение

MCP Gateway предоставляет AI-клиентам стабильные resources и tools поверх Memory API. Он не содержит отдельную бизнес-логику памяти и не обходит RLS.

Baseline разработки SHOULD учитывать актуальную редакцию MCP `2026-07-28` со stateless protocol core и иметь compatibility tests для реально поддерживаемых версий клиентов. Изменение MCP фиксируется ADR и contract tests, а не обновляется бесконтрольно.

## 11.2 MCP tools V1

### Read tools

| Tool | Назначение |
|---|---|
| `memory.search` | Hybrid/temporal search с filters и evidence. |
| `memory.get` | Получить запись и разрешенную историю. |
| `memory.history` | Revision/supersession timeline. |
| `memory.conflicts` | Открытые конфликты в scope. |
| `context.user` | Разрешенный профиль и предпочтения. |
| `context.project` | Стартовый контекст проекта. |
| `context.repository` | Репозиторий, branch/PR и engineering state. |
| `project.state` | Current state с version/evidence. |
| `project.timeline` | Временная шкала. |
| `project.decisions` | Активные и исторические решения. |
| `project.tasks` | Открытые/закрытые задачи. |
| `handoff.read` | Последний или указанный handoff. |
| `knowledge.search` | Поиск по документам и источникам. |

### Write tools

| Tool | Назначение |
|---|---|
| `memory.remember` | Создать типизированную memory candidate/record. |
| `memory.correct` | Исправить с новой revision и reason. |
| `memory.supersede` | Заменить запись новой с temporal link. |
| `memory.forget` | Исключить из активного retrieval по policy. |
| `decision.record` | Записать решение с rationale. |
| `task.record` / `task.update` | Создать или изменить задачу. |
| `project.update_state` | Optimistic update project state. |
| `session.start` | Открыть агентскую сессию. |
| `session.record` | Записать проверяемое session event. |
| `session.finish` | Завершить сессию и инициировать handoff. |
| `handoff.create` | Создать handoff. |

Write tools MUST быть отделены scopes от read tools. Деструктивное физическое удаление не публикуется как обычный model-controlled tool; оно проходит через Web/PWA или подтвержденный privacy workflow.

## 11.3 MCP resources

Рекомендуемые URI:

```text
memory://projects/{project_id}/state
memory://projects/{project_id}/handoff/latest
memory://projects/{project_id}/decisions/active
memory://sessions/{session_id}
memory://records/{record_id}
memory://artifacts/{artifact_id}/metadata
```

Resource read всегда выполняет policy decision и не раскрывает storage signed URL без отдельного короткоживущего grant.

## 11.4 Tool contract rules

- JSON Schema версионируется.
- Все writes принимают `idempotency_key`.
- Update принимает `expected_version`.
- Tool result возвращает `trace_id`, `policy_decision`, `record IDs` и warnings.
- Sensitive content не попадает в error message или logs.
- Tool annotations считаются недоверенными на уровне клиента; сервер опирается на собственные policies.
- Любой write имеет actor, client_id и audit event.
- Сервер отклоняет unknown fields для strict write schemas либо явно версионирует extension point.

## 11.5 Auth для MCP

Remote MCP MUST использовать совместимую с текущей спецификацией OAuth 2.1 модель:

- HTTPS;
- PKCE для public clients;
- короткоживущие access tokens;
- rotation refresh tokens, где применимо;
- resource/audience binding и validation;
- отдельные upstream provider tokens;
- полный запрет token passthrough;
- scopes по tool group, project и sensitivity;
- revoke и session/token audit.

## 11.6 ChatGPT

ChatGPT подключается к remote MCP/custom app, если это поддерживается тарифом и workspace policy. На дату baseline полный custom MCP с write/modify доступен для Business и Enterprise/Edu, а Pro имеет ограничения read/fetch. Поэтому:

- `ChatGPT write enabled` является внешним deployment gate, а не предположением кода;
- read-only режим MUST оставаться полезным;
- для тарифов без write используется Web/PWA capture, собственный API client или иной разрешенный bridge;
- изменения tool catalog проходят повторное review/publish в ChatGPT workspace;
- сервер не зависит от того, запросит ли ChatGPT подтверждение: обязательные проверки находятся на сервере.

## 11.7 Cursor

Cursor SHOULD получать project/repository scopes, но не personal/private memory по умолчанию. Обязательный flow:

```text
session.start -> context.project -> work -> session.record
-> validation evidence -> session.finish -> handoff.create
```

Локальный developer token не хранится в репозитории. Для remote deployment используется OAuth/device-compatible login или короткоживущая credential flow.

## 11.8 ROMA и будущие агенты

ROMA подключается через MCP или internal API со service identity, allowlisted projects и task-specific scopes. Никакой агент не наследует автоматически права владельца. Создание нового агента требует:

- declared purpose;
- allowed tools;
- project/source/sensitivity scope;
- write categories;
- rate/cost limits;
- owner и expiry/review date.

---

# 12. Universal Connector Platform и SDK

## 12.1 Цель

Новый источник подключается без изменения Memory Core. Connector преобразует внешний provider model в стабильный `ExternalObject` и `IngestionEnvelope`, а Core не знает детали Gmail, PhotoKit или GitHub.

## 12.2 Поддерживаемые способы подключения

| Тип | Примеры |
|---|---|
| OAuth/API | Google, Microsoft, Slack, Notion. |
| MCP | AI-сервисы и внутренние tool/data servers. |
| Webhook | GitHub events, custom business events. |
| REST/GraphQL | Собственные сервисы. |
| File/folder | Local folder, iCloud selection, NAS, SFTP. |
| Database | PostgreSQL, MySQL и read-only views. |
| Manual/share | Текст, файл, фото, voice, URL, Share Extension. |

## 12.3 Connector lifecycle interface

Каждый connector MUST реализовать применимый набор:

```text
authenticate()
refresh_auth()
discover()
validate_scope()
initial_sync()
incremental_sync(cursor)
fetch(object_ref)
normalize(raw_object)
checkpoint()
resume()
healthcheck()
revoke()
```

При write capabilities отдельно:

```text
create()
update()
delete()
```

Write capability отключена по умолчанию и требует отдельного provider scope, agent scope и confirmation policy.

## 12.4 Connector manifest

```yaml
id: github
version: 1.0.0
sdk_version: ^1.0
auth: oauth2_or_github_app
capabilities:
  - repositories.read
  - issues.read
  - pull_requests.read
  - events.webhook
supports:
  initial_sync: true
  incremental_sync: true
  webhooks: true
  live_fetch: true
  write: false
storage_modes:
  - reference
  - indexed
rate_limit_strategy: provider_headers
data_classes:
  - internal
```

Manifest MUST включать schemas, migrations/compatibility, scopes, data classes, rate-limit strategy, retention defaults и health probes.

## 12.5 Normalized ExternalObject

```json
{
  "provider": "notion",
  "account_id": "...",
  "collection_id": "...",
  "external_id": "...",
  "external_version": "...",
  "type": "document",
  "title": "...",
  "content_reference": "...",
  "author": {"external_id": "...", "display_name": "..."},
  "created_at": "...",
  "modified_at": "...",
  "deleted": false,
  "attachments": [],
  "permissions_snapshot": {},
  "metadata": {},
  "canonical_reference": "..."
}
```

## 12.6 Sync modes

- **Pull:** initial/full и periodic incremental sync.
- **Push:** verified webhook/event delivery, после которого worker fetches authoritative state.
- **On-demand:** live fetch без предварительного полного индекса.
- **Hybrid:** webhook как сигнал плюс reconciliation poll.

Connector MUST сохранять opaque cursor, query parameters/collection scope и schema version. При invalid cursor запускается bounded resync, а не бесконтрольное удаление.

## 12.7 Storage modes

| Режим | Что хранится |
|---|---|
| `reference` | ID, metadata, permissions snapshot, checksum/version и ссылка. |
| `indexed` | Reference плюс извлеченный текст, chunks, summary и embeddings. |
| `archived` | Indexed плюс независимая versioned копия оригинала. |

Пользователь выбирает режим по account/collection/object. Более широкий режим не наследуется автоматически при добавлении нового scope.

## 12.8 Две границы прав

```text
effective access = source permission
                 INTERSECT connector selection
                 INTERSECT workspace ACL/RLS
                 INTERSECT agent scope
                 INTERSECT sensitivity policy
```

Пример: Google разрешил доступ к Drive, пользователь выбрал папку Contracts, ChatGPT имеет read Contracts, Cursor имеет только AISTROYKA technical docs. Cursor не получает Contracts, даже если connector может их прочитать.

## 12.9 Secrets и auth

- Tokens находятся в managed secrets vault/KMS, в БД хранится reference.
- Refresh выполняется только connector runtime.
- Логи не содержат tokens, authorization codes или sensitive payloads.
- Revoke немедленно останавливает jobs и webhooks, затем применяет retention policy.
- OAuth scopes минимальны; broad/restricted scopes требуют отдельного UX warning и compliance gate.
- Connector account имеет health: connected, degraded, reauth_required, revoked, disabled.

## 12.10 Connector certification tests

Новый connector не принимается без:

- manifest/schema validation;
- auth/revoke tests;
- initial and incremental sync fixtures;
- cursor expiration recovery;
- duplicate delivery test;
- rate-limit and retry test;
- deletion/permission change propagation;
- poison object isolation;
- contract tests against SDK supported versions;
- data classification и privacy review;
- end-to-end provenance verification.

---

# 13. Reference connectors

## 13.1 GitHub

### Scope

Repositories, branches, commits, pull requests, reviews, issues, releases и workflow metadata. Code contents индексируются только для выбранных repositories/paths и не являются обязательными для V1.

### Architecture

- GitHub App предпочтительнее personal access token для управляемых repository permissions.
- Webhook receiver проверяет `X-Hub-Signature-256` до JSON parsing.
- `X-GitHub-Delivery` используется как idempotency key.
- Receiver быстро подтверждает delivery и передает обработку queue worker.
- Reconciliation poll закрывает пропущенные deliveries.
- Webhook событие является сигналом; при необходимости fetch API получает актуальное состояние объекта.

### Acceptance focus

- Install app только на выбранные repositories.
- PR merge обновляет timeline и project state через evidence.
- Повтор delivery не создает второе событие.
- Удаленный/закрытый object корректно меняет состояние без уничтожения audit trail.

## 13.2 Google Drive

### Scope

Выбранные файлы/папки, metadata, permissions snapshot, exports Google Docs/Sheets/Slides и изменения.

### Authorization

Baseline SHOULD использовать Google Picker и scope `drive.file`, когда пользователь выбирает конкретные файлы. Полное фоновое индексирование всех файлов может потребовать restricted `drive.readonly`, verification и security assessment. Широкий scope не является условием V1.

### Sync

- Initial selection/discovery.
- `changes.getStartPageToken` и `changes.list` для incremental sync.
- `changes.watch` MAY использоваться как notification; детали затем читаются из change feed.
- Cursor хранится per account/drive/scope.
- Permission loss немедленно исключает объект из retrieval и запускает retention policy.

### Storage

- `reference` для большинства файлов по умолчанию.
- `indexed` для выбранных документов.
- `archived` только по явному правилу.

## 13.3 Gmail

### Scope

Selected labels/accounts, message/thread metadata, bodies и attachments в зависимости от scope. По умолчанию SHOULD начинать с metadata/reference и explicit labels, а не со всего mailbox.

### Sync

- Initial full sync для выбранной области.
- Partial sync через `history.list` с `startHistoryId`.
- При `HTTP 404` для устаревшего history ID запускается bounded full resync.
- Message и thread IDs сохраняются; labels и deletion changes обрабатываются.

### Privacy

- Gmail относится минимум к `personal`, а выбранные категории MAY быть `confidential/restricted`.
- Email bodies не доступны Cursor/ROMA без explicit ACL.
- Restricted Google scopes и хранение данных на сервере проходят отдельный verification/compliance gate.
- Quoted reply chains и signatures SHOULD отделяться при parsing, но original сохраняется по policy.

## 13.4 Google Calendar

### Scope

Selected calendars, event metadata, attendees и descriptions согласно user selection.

### Sync

- Initial full sync получает `nextSyncToken`.
- Incremental requests используют тот же набор query parameters.
- Deleted entries обрабатываются явно.
- При `410 Gone` локальная проекция выбранного calendar очищается и выполняется полный resync.
- Recurring events хранят master/instance relationship и timezone.

Private events по умолчанию сохраняются как busy interval + restricted metadata, если пользователь не разрешил содержание.

## 13.5 Future connectors

После прохождения reference connectors SDK должен поддерживать добавление Notion, Slack, Airtable, Dropbox, OneDrive, Outlook, GitLab, Jira, Linear, Vercel, databases, SFTP, CRM, ERP и custom REST/MCP без изменения Memory Core.

---

# 14. Apple integration: iOS/macOS companion

## 14.1 Архитектурное ограничение

«iCloud» не является единым API для произвольного чтения всех пользовательских данных. Реализация делится на:

- PhotoKit для системной Photos Library, включая доступные через iCloud Photos assets;
- system document picker и security-scoped URLs/bookmarks для выбранных файлов и папок;
- CloudKit/iCloud container только для собственных данных и device sync Sasha Memory companion;
- Share Extensions для явной отправки файла, фото, ссылки или текста.

Native companion является обязательным: server-only connector не может легитимно заменить пользовательское разрешение и sandbox model Apple.

## 14.2 Общие компоненты companion

- Swift/SwiftUI app для iOS и macOS с shared domain package;
- secure login к Memory OS;
- локальная encrypted queue;
- background upload/sync в пределах возможностей платформы;
- connection status и permission inspector;
- on-device hashing и metadata extraction;
- upload policy: Wi-Fi only, charging, size limits, originals vs derivatives;
- Share Extension для Files/Photos/links/text;
- explicit revoke и очистка локального cache.

## 14.3 iCloud Drive / Files

Пользователь выбирает документ или directory через system picker. Companion MUST:

- работать только с user-selected URLs;
- вызывать `startAccessingSecurityScopedResource()` и гарантированно `stopAccessing...`;
- сохранять security-scoped bookmark для persistent access, если платформа это поддерживает;
- обрабатывать stale bookmark и повторный user selection;
- использовать file coordination при чтении внешних документов;
- отслеживать size, modification date, provider item identifier и content hash;
- не копировать original в Supabase при `reference/indexed`, если достаточно извлеченного текста;
- явно показывать, когда file недоступен offline или permission отозван.

macOS companion SHOULD обеспечивать более надежный folder monitoring. iOS background execution ограничена платформой, поэтому обещание непрерывной фоновой индексации OUT; sync выполняется opportunistically, при share/import и разрешенных background tasks.

## 14.4 Photos / iCloud Photos

PhotoKit connector MUST:

- запрашивать разрешение только после user action и с понятным purpose string;
- поддерживать Limited Library и Full Library access;
- корректно работать, когда пользователь меняет selected assets;
- использовать persistent change token/observer для incremental changes, где доступно;
- хранить local/cloud identifiers и checksum/derivative metadata;
- не загружать original без storage policy и user-visible estimate;
- обрабатывать asset, который находится в iCloud и еще не скачан на устройство;
- уважать network/cellular policy;
- исключать отозванные assets из retrieval и применять retention policy.

Baseline V1 для фото: metadata, thumbnail, OCR и user-selected originals. Полная индексация всей медиатеки относится к opt-in beta после privacy, battery и cost evaluation.

## 14.5 CloudKit

CloudKit MAY использоваться для:

- настроек companion;
- device registration;
- локальной очереди/состояния синхронизации собственных данных приложения;
- Apple-device continuity.

CloudKit не используется для попытки читать произвольные файлы iCloud Drive или данные других приложений. Контейнер приложения отделен от внешней канонической памяти в Supabase.

## 14.6 Share Extensions

Share sheet MUST поддерживать:

- фото/видео;
- файл;
- URL;
- выделенный текст;
- project, memory type, sensitivity и storage mode;
- offline queue с видимым статусом.

Extension не должна выполнять тяжелый OCR/LLM внутри ограниченного extension runtime: она создает локальный durable item, а companion продолжает обработку.

## 14.7 Apple acceptance criteria

- Limited Photos access импортирует только выбранные assets.
- Смена выбора и revoke отражаются без повторной установки приложения.
- Выбранная iCloud Drive папка индексируется без доступа к соседним папкам.
- Stale bookmark приводит к понятному reselect flow, а не к silent failure.
- Большой файл не блокирует UI и может возобновить upload.
- Offline share сохраняется локально и синхронизируется после восстановления сети.
- User может увидеть список переданных objects и удалить их из Memory OS.
- Energy/network usage проходит Instruments и device tests до beta.

---

# 15. Web/PWA

## 15.1 Назначение

Web/PWA является control center памяти, а не только search box. Пользователь должен понимать, какие данные сохранены, откуда они пришли, кому доступны и что является актуальным.

## 15.2 Обязательные разделы

| Раздел | Функции |
|---|---|
| Home | Последние изменения, active projects, sync warnings, review queue. |
| Search | Hybrid search, filters, current/history toggle, citations. |
| Projects | State, timeline, decisions, tasks, handoffs, linked sources. |
| Memory | Inspector записи, evidence, revisions, conflicts, correct/supersede/forget. |
| Documents | Artifacts, versions, processing status, storage mode. |
| Connections | Add/revoke, scopes, selected collections, sync health, last cursor. |
| Agents & Access | Scopes ChatGPT/Cursor/ROMA, project and sensitivity matrix. |
| Activity & Audit | Reads, writes, connector jobs, policy decisions. |
| Privacy | Retention, export, deletion requests, storage estimates. |
| Settings | Models, language, notifications, cost/network policies. |

## 15.3 Search UX

- Query bar с project/source/type/date/status filters.
- По умолчанию current truth; отдельный switch `Include history`.
- Каждый result показывает type, status, source, valid time и freshness.
- Side panel показывает evidence excerpt и original reference.
- Conflict/disputed records имеют явный warning.
- «No answer» не заменяется похожим, но неподтвержденным текстом.

## 15.4 Memory review UX

Пользователь может:

- approve/reject candidate;
- correct value и указать reason;
- merge duplicate;
- choose authoritative source;
- supersede decision;
- change sensitivity или project scope;
- pin/unpin importance;
- request deletion.

Каждое действие preview показывает последствия: какие active views, embeddings, agents и connectors затронуты.

## 15.5 PWA/offline

PWA MAY кэшировать shell, saved searches и user-created drafts. Sensitive search results и source contents не кэшируются offline по умолчанию. Offline capture шифруется локально и требует повторной проверки сессии перед upload.

## 15.6 Accessibility

- Keyboard navigation для основных flows.
- Семантические headings, labels, focus order и live status.
- WCAG 2.2 AA как target для Web/PWA.
- Цвет не является единственным индикатором статуса.
- Audit и conflict tables имеют доступные названия и фильтры.

---

# 16. Security, ACL, RLS и privacy

## 16.1 Threat model

Минимальный threat model включает:

- cross-tenant или cross-project data leak;
- чрезмерные agent scopes;
- theft connector refresh tokens;
- prompt injection/tool instructions внутри документов и писем;
- malicious files, archives и active content;
- SSRF через URL ingestion или connector configuration;
- forged/replayed webhooks;
- compromised MCP client;
- accidental write/delete;
- логирование secrets или sensitive content;
- stale permissions после revoke во внешнем сервисе;
- supply-chain compromise parser/SDK;
- backup, export или signed URL exposure.

## 16.2 Authorization model

Authorization выполняется централизованным policy layer и RLS. Рекомендуемая модель сочетает RBAC и ABAC:

- subject role;
- workspace/project/source scope;
- object sensitivity;
- memory type/tool action;
- purpose/client;
- current connection permission;
- explicit deny, который приоритетнее grant.

RLS MUST быть включен на всех exposed tables. Views используют `security_invoker` либо находятся в private schema. `service_role` доступен только server-side trusted components и не передается Web/PWA или companion.

## 16.3 Baseline agent matrix

| Subject | Read | Write | Default deny |
|---|---|---|---|
| ChatGPT | Разрешенная personal/project memory. | decisions, tasks, summaries, explicit memories. | destructive purge, secrets. |
| Cursor | Project/repository/engineering context. | session events, engineering changes, handoff. | mail, finance, unrelated personal data. |
| ROMA | Assigned project, audit evidence, QA state. | findings, test results, handoff. | personal profile и unrelated sources. |
| Connector worker | Свой account/collection и job data. | external objects/source events. | другие connectors и agent memories. |
| Web user | Собственный workspace по UI policy. | Все подтвержденные owner actions. | server secrets/raw credentials. |

Матрица является начальной; реальные grants хранятся как policies и проходят automated negative tests.

## 16.4 Secrets и encryption

- TLS для всех сетевых соединений.
- Provider tokens и webhook secrets в vault/KMS.
- Encryption at rest провайдера плюс application-level encryption для selected restricted fields, если требуется threat model.
- Signed URLs короткоживущие, audience/scope bound и не логируются.
- Mobile local queue и credentials используют Keychain/Secure Enclave доступные механизмы.
- Key rotation runbook и emergency revoke обязательны до beta.

## 16.5 Prompt injection и untrusted content

Все данные из внешних источников считаются недоверенными. Система MUST:

- отделять retrieved content от system/tool instructions;
- маркировать source boundaries;
- не разрешать документу изменять tool policy;
- фильтровать/анализировать suspicious instructions и сохранять risk signals;
- не выполнять URL, code или tool call, найденный в документе;
- ограничивать egress и allowlist live connectors;
- требовать server authorization независимо от LLM output;
- включать prompt-injection fixtures в security tests.

## 16.6 Audit

Audit event включает actor, client, action, object/scope, timestamp, policy decision, reason, trace ID, result и изменения до/после без избыточного sensitive payload. Audit append-only для прикладных ролей и имеет отдельную retention policy.

Обязательные события:

- login/token/revoke;
- connector add/scope change/disconnect;
- search/read/fetch restricted content;
- create/correct/supersede/forget/delete;
- RLS/policy denial;
- export;
- backup/restore;
- admin/operator action;
- model/rule version change, повлиявший на memory projections.

## 16.7 Data classification и privacy controls

| Класс | Пример | Default |
|---|---|---|
| public | Публичный README. | Может быть доступен проектным агентам. |
| internal | Внутренние рабочие заметки. | Workspace/project ACL. |
| personal | Письма, календарь, location. | Владелец; agents только explicit. |
| confidential | Договор, финансовый документ. | Explicit grants, enhanced audit. |
| restricted | Secrets, credentials, особо чувствительные данные. | Не индексировать для general agents; special workflow. |

Система MUST поддерживать source/object-level retention, export, deletion, consent history и purpose limitation. Изменение sensitivity пересчитывает доступ и очищает недопустимые caches.

## 16.8 Privacy UX

Перед подключением источник показывает:

- requested scopes;
- какие collections/labels/repos доступны;
- storage mode;
- будет ли content отправляться внешнему LLM/OCR provider;
- retention после disconnect;
- оценку объема и стоимости;
- список агентов, которые получат доступ.

---

# 17. Нефункциональные требования

## 17.1 Reliability и consistency

- Durable event прием до asynchronous enrichment.
- At-least-once delivery с idempotent consumers.
- Transactional outbox для критических внутренних событий.
- Optimistic concurrency для state и mutable projections.
- Reconciliation jobs для webhook connectors.
- Нет silent data loss: partial/error status доступен пользователю.

## 17.2 SLO private beta

| Метрика | Цель |
|---|---|
| Availability Memory API/MCP | 99.5% в месяц, исключая planned maintenance. |
| `project.state` p95 | до 700 ms без live fetch. |
| Hybrid search p95 | до 2.0 s для пилотного объема. |
| Agentic retrieval p95 | до 8 s без учета медленного upstream provider. |
| Durable write receipt p95 | до 1.0 s. |
| Webhook acknowledgment | до 5 s; обработка асинхронно. |
| Ingestion text/DOCX 10 MB | searchable до 2 min p95. |
| PDF 100 pages | searchable до 5 min p95 при доступном OCR capacity. |
| ACL leakage | 0 подтвержденных случаев. |

После benchmark значения пересматриваются ADR/SLO документом. Latency всегда сопровождается dataset size и environment.

## 17.3 Scalability

- Stateless API/MCP instances масштабируются горизонтально.
- Workers масштабируются по queue и job type.
- Event/audit tables MAY партиционироваться по времени после измерения.
- Vector/FTS indexes и query plans контролируются на production-like data.
- Large initial sync имеет concurrency, quota и cost budgets per connector.

## 17.4 Observability

Обязательны structured logs, metrics и distributed traces с единым `trace_id`. Dashboard минимум:

- API/MCP errors и latency;
- queue depth/age;
- ingestion stage throughput и failure rate;
- connector auth/health/cursor lag;
- provider quota/rate limits;
- retrieval zero-result и conflict rates;
- embedding/LLM cost and latency;
- RLS/policy denials;
- backup freshness и restore status.

Sensitive content и tokens не входят в telemetry. Alert имеет runbook и owner.

## 17.5 Maintainability и portability

- Все schemas через migrations.
- API/MCP/SDK имеют semantic versioning и deprecation policy.
- LLM, embedding, OCR и storage adapters заменяемы.
- Business rules покрыты unit tests без вызова внешней модели.
- Development, staging и production используют отдельные projects/secrets.
- Production data не копируется в test environment без anonymization.

## 17.6 Cost controls

- Per-workspace/provider budgets.
- Dedup до OCR/embeddings.
- Reference mode по умолчанию для тяжелых источников.
- Batch embeddings и caching model outputs по content/model hash.
- Live fetch только при freshness need.
- Admin dashboard показывает storage, vector, OCR, LLM и connector usage.

---

# 18. Testing strategy

## 18.1 Test pyramid

| Уровень | Обязательное покрытие |
|---|---|
| Unit | Domain rules, temporal intervals, supersession, policy helpers, parsers. |
| Schema/contract | OpenAPI, MCP JSON Schema, Connector SDK, event versions. |
| Database | Migrations, constraints, RLS positive/negative, transaction behavior. |
| Integration | Supabase, Storage, queue, OAuth mock, provider fixtures. |
| End-to-end | ChatGPT/Cursor-like client -> MCP -> memory -> retrieval -> handoff. |
| Retrieval eval | Golden set и regression metrics. |
| Security | Prompt injection, SSRF, webhook spoof/replay, token/audience, file bombs. |
| Load/soak | Pilot volume, long sync, queue recovery, vector/FTS query plans. |
| Resilience | Provider outage, expired cursor, duplicate event, worker crash. |
| DR | Database + Storage restore и checksum/provenance verification. |
| Native | Permission transitions, offline, background, battery/network, share extensions. |

## 18.2 RLS test matrix

Для каждой таблицы и RPC MUST быть минимум:

- owner success;
- correct agent/project success;
- wrong workspace deny;
- wrong project deny;
- sensitivity deny;
- revoked connector deny;
- direct table access deny при разрешенном API path;
- service worker ограничен своим job/account;
- view/function не обходит RLS.

Наличие только positive tests блокирует release.

## 18.3 Temporal/conflict tests

- Fact A active, Fact B supersedes A: current query возвращает B, history - A и B.
- Backdated correction сохраняет system-time history.
- Overlapping incompatible intervals создают conflict candidate.
- Retracted evidence снижает/отзывает verified status.
- Cycle supersession отклоняется constraint/domain rule.
- Two concurrent project state updates дают deterministic conflict.

## 18.4 Connector tests

- Full sync, incremental sync, webhook и reconciliation.
- Expired token/reauth.
- Invalid/expired cursor.
- Permission removed at source.
- Object renamed/moved/deleted/restored.
- Duplicate and out-of-order deliveries.
- Rate limit и `Retry-After`.
- Partial object failure не останавливает весь stream.
- Disconnect применяет retention и закрывает webhooks/jobs.

## 18.5 Release regression suite

Перед каждым release candidate запускаются:

- schema migration on production-like snapshot;
- RLS negative suite;
- MCP client compatibility suite;
- Connector SDK certification fixtures;
- retrieval golden set с порогами;
- backup restore smoke;
- OWASP/dependency/secret scans;
- Web accessibility smoke;
- iOS/macOS permission/offline smoke для затронутой версии.

---

# 19. Приемочные критерии по подсистемам

## 19.1 Foundation и data

- [ ] Отдельные dev/staging/prod Supabase projects созданы из versioned migrations.
- [ ] Все exposed tables имеют RLS и negative tests.
- [ ] Event store принимает повторное событие идемпотентно.
- [ ] Artifact checksum и version связаны с source event.
- [ ] Audit фиксирует все read/write/admin paths.
- [ ] Database и Storage backup/restore пройдены.

## 19.2 Memory Core

- [ ] Создаются fact, idea, decision, task, project state и handoff.
- [ ] Каждая критическая запись имеет provenance либо user assertion.
- [ ] Correction не стирает предыдущую версию.
- [ ] Superseded запись исключается из current truth.
- [ ] Conflict queue показывает доказательства и позволяет resolution.
- [ ] Project state update защищен optimistic concurrency.

## 19.3 Ingestion

- [ ] Text, PDF, DOCX, image, audio и URL проходят единый envelope.
- [ ] Scanned PDF имеет OCR и page evidence.
- [ ] Voice transcript имеет timestamp evidence.
- [ ] Malicious/oversized input изолируется.
- [ ] Повтор job не дублирует chunks/embeddings/memory candidates.
- [ ] Partial failure виден пользователю и replayable.

## 19.4 Retrieval

- [ ] SQL, FTS и vector candidates объединяются hybrid ranking.
- [ ] Temporal and status filters корректно различают current/history.
- [ ] Evidence returned для каждого критического result.
- [ ] Forbidden records не попадают в candidate set или model context.
- [ ] Golden set проходит согласованные thresholds.
- [ ] No-answer сценарий не выдумывает факт.

## 19.5 MCP и agents

- [ ] Read и write scopes разделены.
- [ ] Все writes имеют actor, idempotency и audit.
- [ ] Cursor получает project context и создает handoff.
- [ ] ChatGPT deployment проверен в фактически доступном тарифе; fallback задокументирован.
- [ ] ROMA/future agent имеет purpose-bound service identity.
- [ ] Token audience validation и no-passthrough security tests пройдены.

## 19.6 Connectors

- [ ] Connector SDK contract стабилен и versioned.
- [ ] Reference connectors используют одинаковый normalized object/envelope.
- [ ] Cursor/checkpoint восстанавливается после сбоя.
- [ ] Revoke и source permission loss немедленно влияют на retrieval.
- [ ] Reference/indexed/archived режимы работают раздельно.
- [ ] Health, retry, dead letter и replay доступны operator/user.

## 19.7 Web/PWA и Apple

- [ ] Пользователь может найти, проверить, исправить, supersede и удалить запись.
- [ ] Connections UI показывает scopes, storage mode и sync health.
- [ ] Agent access matrix редактируется и тестируется preview.
- [ ] Limited Photos и selected iCloud Drive scope не расширяются скрыто.
- [ ] Share Extension поддерживает offline queue.
- [ ] Privacy export/delete workflow завершает все производные данные.

---

# 20. Roadmap и milestones

## 20.1 Модель планирования

Roadmap рассчитан на кросс-функциональную команду 5-7 FTE: tech lead/architect, 2 backend/platform engineers, frontend engineer, Apple engineer, QA/SDET и part-time product/security/SRE. Команда 1-2 человека может выполнять тот же порядок, но календарная длительность возрастет примерно в 2-3 раза.

Security, evaluation, observability и documentation идут сквозными tracks, а не откладываются до последнего milestone.

## 20.2 Сводная карта

| Milestone | Оценка | Главный результат | Exit gate |
|---|---:|---|---|
| M0 Discovery & governance | 2 нед. | Scope, ADR, threat model, eval set | RG0 |
| M1 Platform foundation | 3 нед. | Environments, CI/CD, auth, telemetry | Foundation ready |
| M2 Event store & data model | 4 нед. | Schema, RLS, provenance, audit | Data gate |
| M3 Universal ingestion V1 | 4 нед. | Text/PDF/DOCX/image/audio/link | Ingestion alpha |
| M4 Memory Core V1 | 5 нед. | Facts/decisions/tasks/state/handoff | Memory alpha |
| M5 Retrieval V1 | 4 нед. | FTS/vector/hybrid/temporal | Retrieval gate |
| M6 Shared AI Memory / MCP | 4 нед. | Cursor/ROMA/ChatGPT paths | RG1/RG2 |
| M7 Web/PWA control center | 4 нед. | Search, inspector, projects, privacy | Private alpha UX |
| M8 Connector Platform & SDK | 5 нед. | Registry, auth, sync, certification | SDK 1.0 beta |
| M9 Apple companion | 6-8 нед. | Photos, Files/iCloud, Share | Apple beta gate |
| M10 GitHub + Google Drive | 5 нед. | Reference connectors | Connector beta |
| M11 Gmail + Calendar | 4-6 нед. | Restricted personal sources | Privacy beta gate |
| M12 ROMA automation | 3-4 нед. | Audited workflows and proactive jobs | Automation beta |
| M13 Advanced memory | 5-8 нед. | Agentic retrieval, graph optional | Quality gate |
| M14 Hardening & GA | 4-6 нед. | SLO, DR, security, operations | RG5 |

Часть M7, M8 и подготовки Apple может идти параллельно после стабилизации contracts M4-M6. M9 и M10 оба зависят от M8.

## 20.3 M0 - Discovery, governance и security baseline

**Цель:** превратить концепцию в измеряемый scope и снять внешние блокеры.

**Работы:**

- подтвердить тариф/доступ ChatGPT custom MCP;
- определить hosting region, retention и data classes;
- зафиксировать pilot projects/sources/volumes;
- создать ADR-001 canonical memory, ADR-002 event+projection, ADR-003 storage modes;
- threat model и initial DPIA/privacy review;
- выбрать baseline embedding/LLM/OCR adapters без lock-in;
- собрать 100-200 golden retrieval questions и forbidden-access cases;
- UX flows connections, review, correction и handoff.

**Выход:** approved scope, risk register, architecture context, test/eval plan, backlog M1-M3.

**Exit criteria:** нет неизвестного внешнего dependency, которое делает M6/M9/M11 невозможным; owner принимает V1/OUT границы.

## 20.4 M1 - Platform foundation

**Цель:** воспроизводимая и наблюдаемая среда.

**Работы:** monorepo, CI, dev/staging/prod, secret management, auth skeleton, tracing/logging, migrations, queue abstraction, object buckets, dependency/security scans.

**Выход:** deployable empty platform, runbooks, environment promotion.

**Exit criteria:** one-command/CI deploy staging, rollback migration tested, secrets отсутствуют в repository/logs.

## 20.5 M2 - Event store, provenance и access model

**Цель:** надежно принимать события и защищать данные до построения AI-функций.

**Работы:** identity/subjects, projects, source events, artifacts, evidence, audit/access log, RLS/ACL policies, idempotency, outbox, temporal fields, schema versioning.

**Выход:** Data API v1, migration set, RLS matrix, audit viewer stub.

**Exit criteria:** negative RLS suite green; duplicate event test green; source event -> artifact -> evidence trace воспроизводим.

## 20.6 M3 - Universal ingestion V1

**Цель:** единый ingestion contract для ручных источников.

**Работы:** upload/capture API, quarantine, hash/dedup, parsers PDF/DOCX/text, OCR, image metadata/OCR, audio transcription adapter, link fetcher/SSRF protection, chunks, job UI/status.

**Выход:** searchable documents without memory extraction dependency.

**Exit criteria:** format acceptance suite, poison file isolation, replay/idempotency, page/timestamp provenance.

## 20.7 M4 - Memory Core V1

**Цель:** структурированная долговременная память и рабочее состояние.

**Работы:** memory envelope, types, extraction candidates, review, decisions/tasks/ideas/facts, entities, project state versions, handoff, correction/supersession/retraction, consolidation runs.

**Выход:** Memory API v1 и Web admin stub.

**Exit criteria:** сквозные temporal/conflict tests; critical records без provenance не становятся verified; state concurrency test green.

## 20.8 M5 - Retrieval V1

**Цель:** надежный текущий и исторический контекст.

**Работы:** FTS, embeddings, HNSW benchmark, SQL candidates, entity resolution, RRF hybrid, temporal filters, source authority, context packer, evaluation harness.

**Выход:** Retrieval API v1.

**Exit criteria:** agreed golden metrics; 0 forbidden results; latency SLO на pilot dataset; correct no-answer behavior.

## 20.9 M6 - Shared AI Memory и MCP Gateway

**Цель:** два и более агента реально работают с одной памятью.

**Работы:** MCP resources/tools, OAuth scopes, session lifecycle, Cursor integration, ROMA test client, ChatGPT remote deployment/fallback, compatibility tests, human confirmation policies.

**Выход:** shared-memory private alpha.

**Exit criteria:** ChatGPT/Web -> decision -> Cursor context -> work/handoff -> ChatGPT/Web readback проходит end-to-end с audit и provenance.

## 20.10 M7 - Web/PWA control center

**Цель:** пользователь контролирует память без прямой работы с БД.

**Работы:** Home, search, projects, timeline, memory inspector, evidence, conflicts, tasks, handoffs, connections shell, agent scopes, audit, privacy/export/delete, accessibility.

**Выход:** private alpha UI.

**Exit criteria:** owner выполняет top 10 scenarios; no hidden admin-only data fixes; keyboard/accessibility smoke green.

## 20.11 M8 - Connector Platform и SDK

**Цель:** подключаемые источники становятся стабильной платформенной возможностью.

**Работы:** registry/manifest, OAuth broker, vault references, capability/scopes, initial/incremental sync, cursors, webhook receiver, retries/DLQ, rate limits, storage modes, SDK test kit, Connections UI.

**Выход:** Connector SDK 1.0 beta и sample connector.

**Exit criteria:** sample connector проходит certification; Core не содержит provider-specific branches; revoke/resync/replay tested.

## 20.12 M9 - Apple companion

**Цель:** безопасный user-mediated доступ к Apple data.

**Работы:** iOS/macOS app, auth, local encrypted queue, document picker/bookmarks/file coordination, PhotoKit limited/full, change tracking, derivatives/upload policy, Share Extensions, connection UX.

**Выход:** TestFlight/internal macOS beta.

**Exit criteria:** Apple acceptance criteria раздела 14; privacy review; energy/network/device matrix; no scope expansion.

## 20.13 M10 - GitHub и Google Drive

**Цель:** проверить SDK на двух принципиально разных cloud sources.

**Работы:** GitHub App/webhooks/reconcile, selected repos; Drive Picker/scopes/change tokens/watch, selected files/folders; exports/parsers; source permission propagation.

**Выход:** Connector beta.

**Exit criteria:** both connectors pass certification; missed webhook/change recovery; provenance links to authoritative source.

## 20.14 M11 - Gmail и Google Calendar

**Цель:** добавить highly personal sources с более строгими controls.

**Работы:** OAuth verification path, selected labels/calendars, Gmail history sync, Calendar sync tokens/410 recovery, privacy redaction, private events, attachment policy, agent default denies.

**Выход:** opt-in personal sources beta.

**Exit criteria:** privacy/security review, restricted scope requirements met, Cursor/ROMA negative access tests, deletion/permission propagation.

## 20.15 M12 - ROMA и automation

**Цель:** безопасные repeatable workflows поверх общей памяти.

**Работы:** purpose-bound agent identities, scheduled jobs, QA findings, project health summaries, notifications, approval checkpoints, action budgets.

**Выход:** automation beta.

**Exit criteria:** every automated write is explainable, bounded, reversible where applicable, and audited; no broad owner token.

## 20.16 M13 - Advanced memory

**Цель:** повысить качество сложных запросов после стабильной V1.

**Возможности:** bounded agentic retrieval, graph projection/Graphiti evaluation, multi-hop reasoning, proactive consolidation, learned ranking, personalized importance, advanced contradiction detection.

**Exit criteria:** A/B or offline eval показывает измеримое улучшение без ACL/provenance regression и приемлемую стоимость.

## 20.17 M14 - Hardening и GA

**Цель:** операционная готовность.

**Работы:** SLO/error budgets, load/soak, penetration test, DR drills, incident runbooks, support/ops UI, data export/deletion SLAs, dependency upgrade policy, documentation, onboarding.

**Выход:** GA candidate.

**Exit criteria:** RG5 выполнен и подписан product, engineering, security/privacy и operations owners.

---

# 21. Dependencies и critical path

## 21.1 Critical path

```text
M0 -> M1 -> M2 -> M3 -> M4 -> M5 -> M6
                         |           |
                         +-> M7      +-> M8 -> M9/M10 -> M11
                                              |
                                              +-> M12 -> M13 -> M14
```

MCP и Web нельзя надежно завершить до data/RLS/Memory contracts. Reference connectors нельзя строить как отдельные интеграции до Connector SDK baseline. Apple требует native team/certificates и не может быть заменен backend-only работой.

## 21.2 Внешние зависимости

| Зависимость | Влияние | Действие |
|---|---|---|
| ChatGPT plan/workspace MCP capability | Write path может быть недоступен. | Проверить в M0; поддержать read-only и Web/API fallback. |
| Apple Developer account/signing | Блокирует device/TestFlight. | Подготовить до M9, проверить entitlements. |
| Google OAuth verification/security assessment | Может задержать broad Drive/Gmail scopes. | Начать narrow scopes; compliance track до M11. |
| Provider API quotas | Initial sync/latency. | Budgets, backoff, incremental sync, staged rollout. |
| LLM/embedding/OCR providers | Cost, privacy, model changes. | Adapter, versioning, benchmark, no hard lock-in. |
| Supabase plan/PITR/region | RPO, capacity, residency. | Выбрать в M0/M1, documented cost. |

---

# 22. Release gates

## RG0 - Architecture Ready

- Scope/OUT утверждены.
- Threat model и data classification готовы.
- Golden set и initial SLO определены.
- External dependencies проверены.
- ADR canonical memory/event/permissions приняты.

## RG1 - Engineering Alpha

- Manual ingestion, Memory Core и retrieval работают в staging.
- RLS negative suite green.
- Cursor-like client читает/пишет через MCP/API.
- Audit/provenance end-to-end.
- Backup restore smoke пройден.

## RG2 - Shared Memory Private Alpha

- Минимум два клиента проходят handoff flow.
- Temporal current/history качество достигает threshold.
- User correction/supersession работает в Web.
- Нет unresolved critical security findings.
- Incident rollback/revoke runbook tested.

## RG3 - Connector Beta

- Connector SDK 1.0 beta frozen.
- GitHub и Google Drive проходят certification.
- Revoke/permission change/cursor recovery доказаны.
- Connections UI показывает health и scopes.
- Rate/cost limits и DLQ operational.

## RG4 - Personal Sources and Apple Beta

- Apple limited/full permission transitions пройдены на device matrix.
- Gmail/Calendar privacy gates и Google requirements выполнены.
- Personal/confidential default denies для engineering agents доказаны.
- Export/delete охватывает connector-derived data.
- Battery/network/storage budgets приняты.

## RG5 - GA

- SLO на 30-дневном beta window либо согласованном эквиваленте.
- Pen test/security review без open critical/high.
- DR restore базы и Storage пройден в production-like environment.
- Retrieval/temporal/provenance metrics стабильны.
- On-call, runbooks, alerts, support и ownership готовы.
- Privacy policy, consent, retention и deletion SLA утверждены.

---

# 23. Риски и меры снижения

| Риск | Вероятность / ущерб | Митигирование |
|---|---|---|
| Scope creep «подключить все сервисы сразу» | Высокая / высокий | SDK first, reference connectors, жесткие release scopes. |
| Vector-only память становится свалкой | Высокая / высокий | Typed memory, temporal status, provenance, review, event store. |
| ChatGPT custom MCP write недоступен | Средняя / высокий | M0 verification, read-only value, Web/API fallback. |
| iCloud ожидания превышают Apple APIs | Высокая / высокий | Native user-selected model, clear UX, no full-drive promise. |
| LLM extraction создает ложные факты | Высокая / высокий | Candidate state, evidence spans, confidence, user review, evals. |
| Prompt injection из документов | Высокая / высокий | Untrusted boundary, tool policy isolation, egress controls, tests. |
| Connector tokens украдены | Средняя / высокий | Vault, short-lived tokens, rotation, audience, revoke, no logs. |
| Source permission revoked, индекс остается доступен | Средняя / высокий | Permission propagation, TTL/reconcile, fail closed. |
| Дубли и out-of-order webhooks | Высокая / средний | Idempotency, provider versions, event-time handling, reconciliation. |
| Restricted Google scopes задерживают release | Средняя / высокий | Picker/narrow scopes first, early verification track. |
| Supabase DB backup не включает Storage objects | Средняя / высокий | Separate object backup, manifests, restore drills. |
| Embedding model change требует migration | Высокая / средний | Separate versioned embedding table, dual index/re-embed. |
| Mixed-language FTS quality недостаточно | Средняя / средний | `simple` fallback, hybrid retrieval, multilingual eval set. |
| Стоимость OCR/LLM/embeddings растет | Высокая / средний | Reference mode, dedup before enrich, budgets, cache, batch. |
| Сложность early microservices замедляет проект | Средняя / средний | Modular monolith, workers only where needed. |
| Ошибка privacy deletion оставляет derivatives | Средняя / высокий | Lineage graph, deletion orchestration, receipts, periodic audit. |

---

# 24. Engineering process и Definition of Done

## 24.1 Definition of Ready для epic

- Пользовательский результат и OUT сформулированы.
- Data classification и required scopes определены.
- API/event/schema contract draft готов.
- Acceptance и negative/security cases готовы.
- Migration/rollback и observability определены.
- External dependency имеет owner и test environment.

## 24.2 Definition of Done для feature

- Код, migrations и docs reviewed.
- Unit/contract/integration и применимые security tests green.
- RLS positive/negative cases добавлены.
- Telemetry без sensitive leakage.
- Error/retry/revoke behavior реализован.
- User-visible status и recovery path существуют.
- Accessibility проверена для UI.
- Performance проверена пропорционально риску.
- Acceptance пройдена в staging.
- Runbook/ADR/update changelog выполнены.

## 24.3 Change management

- Database migrations forward-only с tested rollback/restore strategy.
- Breaking API/MCP/SDK change требует new version и migration guide.
- Model/rule prompt changes имеют version, eval diff и rollout/rollback.
- Connector schema changes тестируются на saved fixtures старых версий.
- Security policy changes требуют policy diff и negative regression suite.

## 24.4 Environments и release strategy

- Local: synthetic fixtures, local Postgres/Supabase-compatible setup.
- Development: shared integration, fake/provider sandboxes.
- Staging: production-like RLS, indexes, queues, OAuth test accounts.
- Production: progressive rollout, feature flags, canary connectors/workspaces.

Новые extraction/ranking rules работают в shadow mode до влияния на active memory. Connector initial sync запускается сначала на малой выбранной коллекции.

---

# 25. Первые work packages после утверждения

## WP-01 Architecture and repo bootstrap

Артефакты: ADR-001..005, repository skeleton, CI, code owners, environment matrix, secrets policy.

## WP-02 Database and RLS foundation

Артефакты: migrations identity/projects/events/artifacts/audit, RLS matrix, policy tests, seed synthetic workspace.

## WP-03 Event and ingestion contracts

Артефакты: JSON Schemas, idempotency rules, queue/outbox, job lifecycle, trace propagation.

## WP-04 Manual capture and document processing

Артефакты: upload/text/link API, quarantine, PDF/DOCX parser, OCR adapter, chunks/evidence, processing UI.

## WP-05 Typed Memory API

Артефакты: facts/ideas/decisions/tasks, revisions, provenance, conflict/supersession, review queue.

## WP-06 Project state and handoff

Артефакты: state projection, optimistic update, sessions, handoff schema/API, end-to-end fixture.

## WP-07 Retrieval and evaluation

Артефакты: FTS/vector/hybrid, filters/RRF, golden dataset harness, metrics dashboard.

## WP-08 MCP Gateway alpha

Артефакты: OAuth, read/write tool schemas, resources, Cursor test client, ChatGPT compatibility spike.

Рекомендуемый первый демонстрационный slice: `manual decision -> project state -> MCP context -> Cursor handoff -> Web timeline`. Он подтверждает ценность продукта раньше массового ingestion и внешних connectors.

---

# 26. Открытые решения, которые не блокируют baseline

| Вопрос | Baseline до решения |
|---|---|
| Какой ChatGPT plan/workspace используется? | Проверить M0; поддерживать read-only + Web write. |
| Какой embedding model? | Adapter + versioned embeddings; выбрать benchmark. |
| Какой LLM для extraction/rerank? | Provider-neutral contract; schema validation. |
| Какой queue implementation? | Postgres-backed abstraction для V1, заменить по нагрузке. |
| Требуемый data region/residency? | Отдельный EU region, если доступен и соответствует владельцу. |
| Нужен ли полный mailbox/Drive? | Начать с selected labels/files и narrow scopes. |
| Как долго хранить raw conversations? | Configurable; не переводить все в active memory. |
| Нужна ли full Photos indexing? | Нет для V1; selected/opt-in beta. |
| Нужен ли knowledge graph? | Projection/experiment после M12, не dependency Core. |
| Какие dangerous writes разрешены агентам? | Никакие по умолчанию; отдельный ADR/approval. |

---

# 27. Приложение A - пример typed memory

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "project_id": "uuid-aistroyka",
  "memory_type": "decision",
  "title": "Порядок начала Slice 01",
  "content": "Slice 01 начинается после Product Design Audit PR #215.",
  "status": "verified",
  "importance": 0.86,
  "confidence": 0.99,
  "sensitivity": "internal",
  "valid_from": "2026-08-09T00:00:00Z",
  "valid_to": null,
  "observed_at": "2026-08-09T10:30:00Z",
  "recorded_at": "2026-08-09T10:31:00Z",
  "created_by_subject": "chatgpt",
  "provenance": [{
    "provider": "chatgpt",
    "source_event_id": "uuid",
    "conversation_ref": "...",
    "message_ref": "..."
  }],
  "schema_version": "1.0"
}
```

---

# 28. Приложение B - минимальные API endpoints

```text
POST   /v1/ingestion/events
POST   /v1/artifacts/uploads
GET    /v1/jobs/{id}

POST   /v1/memories
GET    /v1/memories/{id}
POST   /v1/memories/{id}/correct
POST   /v1/memories/{id}/supersede
POST   /v1/memories/{id}/forget

POST   /v1/search
GET    /v1/projects/{id}/context
GET    /v1/projects/{id}/state
PATCH  /v1/projects/{id}/state
GET    /v1/projects/{id}/timeline

POST   /v1/sessions
POST   /v1/sessions/{id}/events
POST   /v1/sessions/{id}/finish
POST   /v1/handoffs

GET    /v1/connectors
POST   /v1/connections
POST   /v1/connections/{id}/sync
POST   /v1/connections/{id}/revoke
GET    /v1/connections/{id}/health

POST   /v1/privacy/exports
POST   /v1/privacy/deletions
GET    /v1/audit
```

API path versioning не заменяет schema version внутри events. Idempotency-Key header обязателен для create/write endpoints.

---

# 29. Приложение C - нормативные и технические источники

Baseline сверялся с актуальными официальными источниками на дату документа:

- [OpenAI: Developer mode and MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt)
- [OpenAI: Apps in ChatGPT](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt)
- [Model Context Protocol: specification release 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Model Context Protocol: Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Supabase: RAG with permissions](https://supabase.com/docs/guides/ai/rag-with-permissions)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Vector indexes](https://supabase.com/docs/guides/ai/vector-indexes)
- [Supabase: Full Text Search](https://supabase.com/docs/guides/database/full-text-search)
- [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Apple: PhotoKit](https://developer.apple.com/documentation/photokit)
- [Apple: PHPhotoLibrary](https://developer.apple.com/documentation/photos/phphotolibrary)
- [Apple: Enhanced privacy in Photos apps](https://developer.apple.com/documentation/photokit/delivering-an-enhanced-privacy-experience-in-your-photos-app)
- [Apple: UIDocumentPickerViewController](https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller)
- [Apple: Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox)
- [Apple: CloudKit](https://developer.apple.com/documentation/cloudkit)
- [Google Drive: Retrieve changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Google Drive: Choose API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Gmail: Synchronize clients](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Google Calendar: Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- [GitHub: Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

---

# 30. Итоговый baseline

Sasha Memory OS должна развиваться не как «еще одна RAG-база», а как персональная data and memory platform:

- event store сохраняет доказуемую историю;
- Memory Core превращает события в структурированное знание;
- temporal model отделяет текущую истину от прошлого;
- provenance связывает вывод с первоисточником;
- retrieval сочетает SQL, FTS, vector и ограниченный agentic planning;
- MCP Gateway дает нескольким агентам одну память;
- Connector Platform позволяет добавлять любые источники;
- Web/PWA и Apple companion оставляют контроль у пользователя;
- ACL/RLS/privacy/audit/backups являются частью архитектуры с первого milestone.

Первый продуктовый приоритет - не максимальное число коннекторов, а надежный цикл `remember -> retrieve -> work -> handoff -> correct`. После доказательства этого цикла Connector SDK и reference connectors расширяют охват без разрушения Memory Core.

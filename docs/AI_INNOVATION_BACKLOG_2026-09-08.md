# AI Innovation Backlog — 2026-09-08

## Purpose

This document captures the AI architecture ideas that belong in Sasha Memory OS as the shared context/knowledge layer for multiple projects and agents. Memory OS should not become a generic agent runtime; its job is to provide governed, provenance-aware, project-scoped context to AISTROYKA, ROMA OS, Growth OS, HiAir and development agents.

## Execution precedence — clarified 2026-10-13

This September document is a capability-priority map, not the current implementation queue. The authoritative execution order is [CURRENT_STATE.json](engineering/CURRENT_STATE.json) and the canonical completion plan cited in AGENTS.md. Start with `SHARED_MEMORY_E2E_REMEDIATION`; retain the M17.4 graph-backfill freeze until its existing live acceptance gates pass. Existing M17.3/entity/graph/retrieval implementations must be reused, not restarted. The [2026-10-13 reconciliation](AI_DIGEST_RECONCILIATION_2026-10-13.md) maps each M-* refinement to checked code, blockers, priority and acceptance criteria. P0 below means a requirement before the relevant future operation, not permission to skip the active canonical remediation.

## Principles

- Memory is not truth by default. Every durable fact should carry provenance, scope, confidence and freshness.
- Retrieval must respect project/tenant/user boundaries before ranking relevance.
- Untrusted retrieved content must never silently become authoritative memory.
- Separate episodic conversation/context, durable project facts, decisions, entities/relationships and generated summaries.
- Prefer hybrid retrieval: exact/keyword + vector + graph traversal + recency/authority scoring.
- Make every context pack inspectable so an agent can explain what it used.
- Keep agent skills and business logic outside Memory OS; Memory OS exposes context contracts and tools.

## P0 — Contract requirements within the canonical sequence

| ID | Capability | Concrete implementation | Definition of done |
|---|---|---|---|
| M-01 | Canonical Context Contract | Standard context-pack schema: request/task, project scope, entities, facts, decisions, evidence refs, recency, confidence, ACL, unresolved conflicts and retrieval trace. | Versioned schema + validation + sample packs for AISTROYKA, ROMA and Growth OS. |
| M-02 | Hybrid GraphRAG | Combine vector/semantic retrieval, lexical search and graph traversal over projects, entities, decisions, artifacts, people/roles and dependencies. | Benchmark corpus + retrieval evals + graph/semantic fusion + explainable retrieval trace. |
| M-03 | Entity Resolution | Stable IDs and aliases for project, repository, branch, document, feature, customer/org, supplier, room/work package and other domain entities. | Merge/split rules, alias history, conflict handling, tests and provenance. |
| M-04 | Provenance / Freshness / Confidence | Every durable memory records source, captured_at, last_verified_at, confidence, scope and optional expiry/revalidation policy. | Required metadata for durable writes + stale/conflict queries + UI/API representation. |
| M-05 | Project & Tenant ACL | Enforce access before retrieval: user/project/tenant namespace, sensitivity class and connector/source permissions. | Deny-by-default ACL tests and cross-project leakage evals. |
| M-06 | Memory Conflict Model | Preserve conflicting claims instead of overwriting silently; expose preferred/current fact only when evidence supports resolution. | Conflict object + resolution state + source comparison + audit trail. |
| M-07 | Context Pack API / MCP Tooling | Read-only tools for `search_memory`, `get_project_context`, `get_entity_context`, `get_decisions`, `get_recent_changes` and `explain_retrieval`. | Stable tool schemas, scoped auth, rate/cost telemetry and contract tests. |
| M-08 | Retrieval Security Boundary | Treat documents, web/RAG text, connector output and agent-written notes as untrusted input; detect/contain prompt injection and instruction-like content. | Content classification, instruction stripping/labeling, safe rendering, adversarial eval suite. |
| M-09 | Decision Memory | Durable decision objects: decision, rationale, alternatives, owner, date, affected projects/components, supersedes/superseded_by and evidence. | Decision schema + read-after-write + conflict/supersession behavior + retrieval tests. |
| M-10 | Context Quality Evals | Measure precision/recall, stale-context rate, cross-project leakage, unsupported assertions, conflict surfacing and token efficiency. | Repeatable eval harness + baseline + regression thresholds. |

## P1 — Refinements after canonical blockers and contract gates

| ID | Capability | Concrete implementation | Expected effect |
|---|---|---|---|
| M-11 | Project Knowledge Graph | Explicit edges among projects, repos, features, issues, documents, decisions, people/roles, milestones and dependencies. | Better multi-hop reasoning and impact analysis. |
| M-12 | Agent Session Memory | Short-lived episodic memory for long-running agent tasks, separated from durable knowledge and expiring by policy. | Better continuity without polluting durable memory. |
| M-13 | Exemplar Store | Curated approved PRs, ADRs, reports, good content, successful workflows and evaluation exemplars, with project scope and provenance. | Better agent alignment through examples rather than giant prompts. |
| M-14 | Change Feed / Context Deltas | Produce compact `what changed since X` packs for agents, weekly reports and project handoffs. | Lower context cost and faster resumption. |
| M-15 | Memory Write Proposals | Agents propose durable memories/decisions; policy/evaluator decides auto-accept, request review or reject. | Prevent low-quality autonomous memory pollution. |
| M-16 | Source Reliability Profiles | Track source class and historical reliability; do not equate internal approved docs with unverified external text. | Better ranking and fewer unsupported conclusions. |
| M-17 | Context Budgeter | Select the smallest sufficient context pack based on task, model context window, cost and risk. | Lower token cost and less context pollution. |
| M-18 | Cross-project Dependency Map | Capture shared infrastructure/capabilities such as agent skills, model routing, auth, analytics and release dependencies. | Safer platform changes across AISTROYKA, HiAir, Growth OS and ROMA. |
| M-19 | Connector Ingestion Contracts | Normalize GitHub, Drive, email and future source ingestion into provenance-aware artifacts without losing source identifiers. | Reliable multi-source knowledge ingestion. |
| M-20 | Memory Observability | Track retrieval latency, top sources, misses, stale hits, conflicts, token cost and downstream acceptance/rejection. | Evidence for tuning retrieval and write policies. |

## P2 — Explore carefully

| ID | Capability | Constraint before adoption |
|---|---|---|
| M-21 | Automatic durable memory promotion | Only for low-risk facts after strong provenance/duplication/conflict checks and measured precision. |
| M-22 | Autonomous conflict resolution | Require authoritative source hierarchy and explicit uncertainty; otherwise keep conflict unresolved. |
| M-23 | Cross-tenant learning | Use only anonymized/aggregated patterns with explicit privacy/legal governance; never leak tenant data. |

## Architecture direction

```text
Sources
(GitHub / Docs / Chat / Connectors / Project Systems)
                         │
                         ▼
                 Ingestion + Provenance
                         │
                         ▼
             Entity Resolution / ACL / Trust
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       Lexical        Vector           Graph
       Index          Index            Store
          └──────────────┼──────────────┘
                         ▼
                  Retrieval Fusion
                         │
                         ▼
                 Context Pack Builder
                         │
                         ▼
       AISTROYKA / ROMA / Growth / HiAir / Coding Agents
```

## Integration contract with Shared Agent Platform

Memory OS provides:

- scoped context;
- provenance and evidence refs;
- decisions and exemplars;
- entity relationships;
- retrieval explanation;
- freshness/conflict metadata.

Memory OS does **not** own:

- action execution;
- business permissions beyond memory access;
- skill orchestration;
- model routing;
- production mutations.

Those belong to the consuming agent platform/domain product.

## Capability dependency order (not the current execution queue)

1. Canonical context schema + provenance/freshness/conflict metadata.
2. ACL-before-retrieval and adversarial leakage/security evals.
3. Hybrid GraphRAG + entity resolution + retrieval trace.
4. Context Pack API/MCP and project-specific packs.
5. Decision memory + exemplar store + change deltas.
6. Context budgeting, observability and memory-write proposals.
7. Increase automatic durable-memory writes only after eval evidence is strong.

## Explicit non-goals

- No dumping every conversation verbatim into durable memory.
- No silent overwrite of conflicting facts.
- No cross-project or cross-tenant retrieval because content is semantically similar.
- No treating model-generated summaries as authoritative without source refs.
- No executing project actions from Memory OS itself.

## Сверка всех доступных AI разборов 2026-10-13

[Матрица existing функций и уточнённых AC](AI_DIGEST_RECONCILIATION_2026-10-13.md) переиспользует M-01…20: scoped task/handoff state, operational lessons/persistence gate, redaction BEFORE embedding, recall feedback и authoritative freshness/structured retrieval. MCP handoff/hybrid search/ACL/graph contracts уже частично есть; complete consumer-resume/privacy/feedback/live graph acceptance не доказаны. SHARED_MEMORY_E2E_REMEDIATION остаётся первым, M17.4 freeze и baseline 32-dim contracts сохранены. Эта запись не подтверждает production readiness.

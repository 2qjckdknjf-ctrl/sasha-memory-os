# AI Innovation Backlog — 2026-09-08

## Purpose

This document captures the AI architecture ideas that belong in Sasha Memory OS as the shared context/knowledge layer for multiple projects and agents. Memory OS should not become a generic agent runtime; its job is to provide governed, provenance-aware, project-scoped context to AISTROYKA, ROMA OS, Growth OS, HiAir and development agents.

## Execution precedence — reconciled 2026-10-23

This is the canonical capability backlog, with one active queue in the [23 October consolidation](#consolidated-execution-queue--2026-10-23) below. The authoritative completion requirements remain the verified Memory OS decision **SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21** (`ce22223e-4001-4368-9d10-cbcfa8c00f6b`, explicit project `44444444-4444-4444-8444-444444444402`) and the [baseline spec](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md).

Fresh live bootstrap/get on 23 October and `origin/main` **63b643a0b2fe5aed7638c9258bf531e369f4ebb9** supersede the stale instruction to restart shared-memory E2E or freeze M17.4: both have recorded live acceptance; M17–M19 and M20.1–M20.3 code are merged. The next bounded slice is **M20.4 privacy/compliance**, already [open PR118](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/118), followed by M20.5 release engineering and M20.6 final acceptance. Real connector/device and other residual release blockers remain open. No mandatory M15–M20 gate is waived.

[CURRENT_STATE.json](engineering/CURRENT_STATE.json) is a dated evidence manifest, not proof of today's environment; its M19/M20.3-in-progress labels lag the retrieved M20.3 live receipt. PR118 already proposes the runtime/manifest reconciliation: do not create a competing implementation. [13 October reconciliation](AI_DIGEST_RECONCILIATION_2026-10-13.md) is retained as historical code inventory. The initial pass changed planning documents only. The authorized review now also includes the minimal development-dependency remediation below. Application deployment, schema migration and GA promotion remain out of scope; the user authorized reviewed merge on 23 October and explicitly prohibited deployment.

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

[Матрица existing функций и уточнённых AC](AI_DIGEST_RECONCILIATION_2026-10-13.md) переиспользует M-01…20: scoped task/handoff state, operational lessons/persistence gate, redaction BEFORE embedding, recall feedback и authoritative freshness/structured retrieval. MCP handoff/hybrid search/ACL/graph contracts уже частично есть; complete consumer-resume/privacy/feedback/live graph acceptance не доказаны. Этот раздел отражает исторический статус 13 октября; очередь и снятые freezes уточнены ниже по новым receipts. Baseline 32-dim contracts сохраняются; эта запись не подтверждает свежую production readiness.


## Consolidated execution queue — 2026-10-23

### Evidence and status boundaries

Repository/default branch: `2qjckdknjf-ctrl/sasha-memory-os`, protected `main`, inspected at **63b643a0b2fe5aed7638c9258bf531e369f4ebb9**. Explicit-project live bootstrap and `memory.get` returned the canonical completion plan and M20.3 receipt on 23 October. A retrievable historical receipt is evidence of that recorded run, not a fresh end-to-end product acceptance. This pass did not rerun production acceptance.

| Capability | Evidence / status | Remaining work |
|---|---|---|
| Source events, scoped ingestion/idempotency, canonicalization/dedupe/conflict/freshness | **MERGED / CODE_PRESENT** M15 packs, existing migrations, schemas/domain store, `packages/db/src/gateway.ts` | Real provider OAuth/consent E2E and downstream publisher policy remain blockers; never equate synthetic contract PASS with real connector acceptance |
| Entity graph, project context, shared ChatGPT/Cursor lifecycle | **MERGED + RECORDED_LIVE_PASS** M17/M18; [CURRENT_STATE](engineering/CURRENT_STATE.json), [M18.2](engineering/M18_SLICE_02.md); same-project read-after-write receipts | No repeated graph/bootstrap implementation. Freshness/source selection still must be checked on each retrieval |
| ROMA findings and source-bound writeback | **MERGED + RECORDED_LIVE_PASS** [M18.3](engineering/M18_SLICE_03.md), [M18.4](engineering/M18_SLICE_04.md); `workers/roma-project-health/src/index.ts` and tests, source ACL/writeback SQL cases | Findings remain candidates, not self-certified truth. Full cross-product authority/audit evidence envelope is a scoped extension, not an already-proven external monitor |
| Owner governance | **MERGED + RECORDED_LIVE_PASS** [M19](engineering/M19_CONTROL_CENTER_GOVERNANCE.md), receipt `4376487c-d83f-42d1-bc1d-2d900baf2a30` | Historical pending/failed-job counts are snapshots; no fresh zero-backlog claim |
| M20.1 security, M20.2 DR, M20.3 performance/retrieval | **MERGED** [#113](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/113)–[#117](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/117). Verified M20.3 memory receipt `1e618a29-8ba6-4da4-871a-d6530863cf2a` records Edge v17, 200-case Recall@10=1.0, ACL leaks=0, live p95=1750ms, [main CI38806721335](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/38806721335) | Do not reimplement or replay these as new features. Recorded Oct15 metrics are not new Oct23 measurements; residual security/operational blockers still gate GA |
| M20.4 privacy/compliance | **PR_ONLY** [#118](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/118), head `c02017d7c2be789b79288a85d4042a918e48b287`, OPEN | Review exact-head CI, real export/delete/revoke/retention evidence and migration sequence; not merged/live. This consolidation does not absorb its code or claim its acceptance |
| Dependency update | **CANDIDATE FIX IN PR122**: reuse [#121](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/121) Vite8.2.4 commit `32668d99c4c3aff3501c33137561eb795b615bfb`; additionally pin Vitest4.1.12 to fix its mocker advisories. Earlier main had confirmed Vite HIGH [alert2](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/security/dependabot/2) and MEDIUM [1](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/security/dependabot/1)/[3](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/security/dependabot/3) | Local frozen install/full tests/typecheck/lint/web build PASS; audit=0 advisories at all severities. Exact-head required CI and post-merge alert readback still gate closure; #121 must not be merged again independently |
| New evidence envelope, consumer-resume proof and source/model benchmark metadata | **PARTIAL / PLANNED** refinements of M-01/04/08/09/12/18/19/20 | Complete remaining acceptance below; a schema field or stored link alone does not prove end-to-end verification |

### AI Scout deduplication and news boundaries

Read actual diffs and states: [#101 / 15 Oct](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/101), [#119 / 18 Oct](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/119), [#120 / 20 Oct](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/120) were **OPEN DRAFT** at the initial inspection. After verified replacement [PR122](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/122), all three were **CLOSED, NOT MERGED / SUPERSEDED** on 23 October; branches/history preserved. All unique recommendations are mapped below. The user subsequently authorized reviewed merge without deployment; required checks and review remain mandatory. No implementation claim follows from closing duplicates.

| Input | Existing canonical IDs / disposition |
|---|---|
| #101 durable handoff/checkpoint | M-01/M-12/M-14, reuse existing handoff + M18 context. Add version/scope/revocation acceptance once |
| #101 structured retrieval/provenance/idempotency | M-04/M-05/M-19 and M15/M20.3 already implement foundations; only unproven consumer/source cases remain |
| #101 context cost/retention | M-17/M-20; privacy retention belongs to existing M20.4 PR118, benchmark later |
| #119 model benchmark decisions/version/date/repository SHA | M-04/M-09/M-13/M-20 single evidence envelope; not a separate benchmark database |
| #119 retriever provider scope/freshness | M-04/M-08/M-16/M-19; experimental provider remains P2 |
| #120 agent evidence/effective scope/approvals/audit | M-01/M-04/M-09/M-18, existing M18 ROMA bridge; runtime authorization remains ROMA/Grow responsibility |
| #120 video/document references and retention | M-04/M-05/M-08/M-19 + M20.4: source-ACL references and derived-data deletion. Preventing secrets/raw-sensitive-data copying is **P0**, not optional P2 |
| Reviews through 23 Oct: monitor completeness, dynamic authority, credential broker, cost/skills | Same evidence envelope: immutable origin, independent verdict, permission/policy/approval revision, cost and source completeness. Memory does not acquire execution authority or store credentials |

Primary references relevant to the design: [METR monitoring exercise, 22 Oct](https://metr.org/blog/2026-10-22-red-teaming-openai-agent-monitoring/) supports testing missing/compacted events and independent evidence (the tested system predates later remediation); [Microsoft dynamic authority, 19 Oct](https://www.microsoft.com/en-us/security/blog/2026/10/19/agents-are-your-newest-insiders-security-must-move-at-their-speed/) motivates versioned scope/expiry; [1Password for AI agents, 22 Oct](https://1password.com/blog/1password-for-ai-agents) is a possible broker integration, not proof of account support or session containment; [Copilot customization metrics, 22 Oct](https://github.blog/changelog/2026-10-22-custom-skills-agents-and-mcp-servers-in-usage-metrics-api/) are usage signals, not skill effectiveness. None is an implementation receipt.

[Digest source](https://chatgpt.com/c/6ac9d8f6-bca8-83ed-a870-d505bf1c9c69) coverage: accessible 19–20 October text, bounded prefixes for 21–23 October and the three Scout diffs; inaccessible tails were not treated as read. Older model claims remain research inputs unless independently verified. Official availability does not establish account access, license/data suitability or benefit to this repository.

### One execution queue with gates and responsible roles

All assignees are **roles**, named owners **TBD / unconfirmed**. Do not infer that a GitHub author accepted ownership. P0 gates the operation it protects; P1 is the next bounded slice after its dependencies; P2 is deferred research. M-xx capability IDs refine the M15–M20 sequence, never replace it. Milestones are evidence gates, not promised calendar dates.

| Existing ID / priority / state | Responsible role / dependencies / milestone | Acceptance evidence |
|---|---|---|
| M20.1 + M20.4; M-04/05/08 / **P0**, PR118 OPEN / dependency fix in PR122 | Security/privacy maintainer (TBD); existing M20.1–3 evidence; **S0 privacy gate** | Verify the #121-derived dependency fix in PR122 using frozen-lock tests/audit, exact-head checks and post-merge alert readback; no suppression. Reuse #118. Export/delete/revoke/retention must cover original source, derived memory/chunks/vector/graph/caches and downstream references; exact subject/project/source ACL and tombstones. Zero leakage in negative tests; no tokens/raw bodies/privacy request text in logs. Read-after-write and authorized export receipts + exact migration/check SHAs. Any skipped live gate remains BLOCKED |
| M15.2/5/6, M20.1/5 / **P0 for GA**, residual blockers | Connector/Ops lead (TBD); real consented credentials and approved publisher policy; **S1 operational closure** | Selected-scope live GitHub/Google restart/duplicate/missed-event/token-expiry/revoke cases; replay produces one logical source state, deny-by-default isolation. Reconcile five historical nonterminal events to real delivery/explicit retained state without false acknowledgement. Rotate/revalidate stale management token through authorized secret workflow; never print it. Apple claims require real device E2E or explicit verified scope decision |
| M-01/04/09/18/19, M18.3/4 / **P1**, PARTIAL | Memory contracts lead + independent ROMA reviewer (TBD); S0 + accepted Grow/ROMA event contract; **S2 provenance contract** | Versioned envelope: task/run, repo+commit, artifact/dataset/config hash, source URI/version/time/access scope, producing actor/tool/model version, independent verifier/verdict/evidence, policy+effective-scope revision, approval ref/expiry/revocation, validity/supersession and retention. 100% accepted benchmark/finding records validate required provenance; missing hash/source/approval becomes incomplete/candidate, never verified |
| M-04/06/08/09, M18.3 / **P0 invariant, P1 extension**, PARTIAL | Security/Memory QA (TBD); S2; **S3 adversarial evidence gate** | Inject forged/missing/reordered/duplicate/compacted events, changed SHA/config, stale source, revoked permission, same idempotency key with different scope and self-authored verifier. No candidate→verified promotion from agent assertion, tool output or scan silence; conflict/supersession preserves history. Evidence gap visible to independent ROMA monitor; Memory cannot certify that an upstream action actually occurred without a receipt |
| M-12/14; M18 context / **P1**, PARTIAL | Grow integration + Memory lead (TBD); S2/S3 and Grow checkpoint contract; **S4 one consumer pilot** | Interrupt/resume one non-production task: task state, failed hypotheses, blockers, source revision, evidence and prior authority recover; resume reauthorizes current scope and refuses expired/revoked permissions. New revision invalidates old verdict. One idempotent checkpoint, no cross-project retrieval and no raw credential/session tokens. Restore from checkpoint never restores execution permissions automatically |
| M-04/05/08/19 + M20.4 / **P1**, PLANNED product adapters | Product data owners (TBD); S0/S2, source ACL/retention contract from AISTROYKA/Obraprecio; **S4 same pilot** | Store authorized video/document references with timecode/frame or section, content/version hash and derived claim linkage, not sensitive raw copies by default. Access revoked/source deleted → reference excluded from retrieval and derived content converges per approved SLA; allowed audit metadata retained without source body. HiAir raw health/location and Trading secrets remain outside general corpus |
| M-10/13/17/20 / **P1 eval, P2 provider experiments** | Evaluation owner (TBD); S2/S3 + canonical M20 gates; **S5 measured context quality** | Reuse 200-case frozen corpus and M20.3 baselines: Recall@10≥95%, ACL leakage=0, hybrid p95≤2000ms; unchanged M13 ranking/budget/writeActionsAttempted=0. Measure tokens/cost per independently verified task, stale/missing-evidence rate, retries and provenance completeness; skill usage counts are not success. Freeze dataset/model/version/cost window and thresholds before run; vendor claim alone cannot select a provider |
| M20.5 → M20.6 / **P0 final release gate**, OPEN | Release owner + human acceptor (TBD); S0/S1, all mandatory M15–M20 gates; **S6 GA decision** | Exact main/schema/deployment versions, all gate PASS/FAIL/unsupported states, CI/security/privacy/DR/perf receipts, rollback/support owners and explicit final acceptance. No known unresolved P0/P1. New provenance pilot is included only if accepted into v1 scope. No v1 tag, application deployment or schema migration from this consolidation |
| M-21/22/23 and speculative model/graph/multimodal expansion / **P2**, DEFERRED | Product/privacy owner (TBD); S6 plus separate scope decision | Existing provenance/security/retrieval baseline, explicit data policy and measurable benefit. Cross-tenant learning, autonomous conflict resolution and automatic promotion do not bypass ACL or human/domain acceptance |

Safe order: review this documentation → finish the existing M20.4 slice and P0 operational/security blockers → M20.5/M20.6 acceptance. S2–S5 may be specified or tested on isolated synthetic data in parallel; production adoption waits for their dependencies and explicit scope. M20 mandatory gates cannot be replaced by a new AI research programme. Shared runtime ownership: Grow owns supervisor/approval/routing/cost outcomes, ROMA owns independent verification/authority/finding lifecycle, Memory owns sourced storage/retrieval. Broker stores credentials; Memory stores non-secret broker/approval references only.

### Open blockers and evidence drift

- #118 and #121 are open PRs, not merged features. Three current Vite Dependabot alerts (one high, two medium) are confirmed. Separately, this consolidation PR's [smoke audit job120429460396](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/39958266244/job/120429460396) on head `236e021c8815c67dee8a85ec8eb93aaad5503901` failed on the unchanged lockfile: **8 advisories (1 high, 6 moderate, 1 low)** including Vite and `@vitest/mocker`; dependent live checks were skipped. This failed evidence is retained. The authorized local repair reuses #121 and additionally updates Vitest to4.1.12: frozen-lock audit now has zero advisories, all1081 local tests pass (15 live-credential cases skipped), typecheck/lint/web build pass. No suppressions or lowered gate; exact-head CI must pass and default-branch alert state must be read back after merge before this blocker is closed. Deployment remains prohibited.
- Real provider OAuth consent/credentials, Apple device E2E, nonterminal publisher policy and management-token automation receipt remain unresolved in current recorded evidence; no freshness assumption from old counts.
- CURRENT_STATE and historical README/M13 digest ordering lag M20.3 live receipt; reconcile via existing #118 and post-merge read-after-write. This PR deliberately does not advance manifest timestamps/operational statuses without that implementation gate.
- Personal assignees, cross-product event schema/version, retention SLA for new media refs and benchmark budgets need explicit assignment/ratification before implementation. New external provider/account eligibility is unproven.
- After an eventual authorized merge, record a canonical milestone with this PR/merge SHA, validation, blockers and next slice, then verify the returned memory by ID/content/project. Until then the GitHub PR is a reviewable proposal, not an accepted canonical Memory decision.


### Dependency review and CI safety — 2026-10-23

The initial smoke failure was caused by existing development dependencies. The candidate reuses Dependabot PR121 instead of duplicating its Vite work and upgrades Vitest4.1.11→4.1.12; upstream [manual-mock advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8) and [redirect traversal advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-xp26-3454-mjgp) name4.1.12 as patched. The audit threshold remains `moderate`; application code, migrations, deployment triggers and verification coverage are unchanged.

Existing CI was inspected before push: ephemeral tests run on isolated Supabase, the live migration preflight and retrieval performance check are read-only, and the live M6 smoke creates one uniquely marked synthetic `ChatGPT smoke decision` then verifies it. That existing script does **not** remove the synthetic record; it does not modify real user records or apply SQL/deploy. The main-only Control Center script reads production metrics and tests access denial through local API/browser processes. The user allowed normal verification while forbidding deployment; these checks are not deployment evidence.

# M20 Slice 03 — performance and retrieval quality gate

Status: implementation and mandatory CI acceptance in progress.

Official pack: `m20-s03-v1`

## Release gates

- Frozen retrieval corpus: exactly 200 ACL-aware cases from
  `tests/eval/golden_retrieval.json`.
- Quality: Recall@10 must be at least 95%; confirmed ACL leakage must remain
  zero. The implementation baseline is 183 relevant cases, Recall@10 `1.0`,
  ACL leakage cases `0`.
- M13 regression: ranking remains `hybrid-rrf+m13-s06-v1`, the only agentic
  retrieval tool remains `memory.search`, the budget remains bounded, and
  `writeActionsAttempted` remains zero.
- Bounded load/soak: five waves reuse the M14 API/MCP harness at concurrency
  three and two rounds per wave. The mandatory run contains 60 operations plus
  five bounded agentic retrieval probes on the ephemeral Supabase stack,
  requires zero API/MCP failures, preserves the M14 hybrid p95 target of 2,000
  ms, enforces the agentic p95 target of 8,000 ms, logs no payload bodies, and
  produces only idempotent candidate captures.
- Routing and dedupe under load: 16 concurrent database capture calls with one
  key must produce one source event, artifact, processing job, and outbox row;
  40 project-ref resolutions must have precision `1.0`; cross-project reuse of
  the same key must be rejected.
- Live check: one bounded warm-up followed by 12 sequential authenticated,
  explicit-project, read-only `memory.search` calls runs against the production
  Edge MCP when live preflight is ready. The steady-state p95 target is 2,000
  ms and response bodies are never printed. Burst pressure remains covered by
  the 60-operation soak and the separate 16-way dedupe/concurrency gate.
- The Edge MCP keeps a bounded five-minute, 128-entry isolate-local query
  embedding cache. Identical requests share one in-flight provider call; failed
  or fallback loads are evicted and retried. Cache keys are SHA-256 digests, not
  query text. This removes repeated provider latency without changing ranking
  weights, persisting queries, or logging payloads.
- Every external read-only query-embedding request has a 700 ms fail-closed latency
  budget. A slow, empty, or failed provider response falls back to the existing
  deterministic local vector while the database preserves ACL-scoped
  structured/text retrieval. Transient fallbacks are not cached, so a later
  request may recover semantic ranking without a deployment. Capture/write
  embeddings bypass this query cache and budget, so they cannot share or persist
  a degraded read-path fallback and cannot make retrieval inherit an unbounded
  write-path provider call.
- A transient provider fallback is never compared with stored provider vectors.
  The request degrades to the same ACL-scoped structured/text search instead of
  widening SQL candidates with incompatible hash-vector matches; later requests
  retry the semantic provider normally.
- Edge search uses a service-role-only bounded wrapper around the authoritative
  ACL/ranking RPC. It fetches a bounded candidate pool of at least 24 and at
  most 50, applies RRF, then returns 12 hits by default or an explicit `limit`
  from 1 to 50. Graph fusion reapplies the same requested limit. This preserves
  Recall@10 headroom while preventing unbounded memory bodies and vectors from
  crossing the database/Edge boundary.

## Idempotency hardening

Migration `20261015220000_m20_capture_idempotency_scope_guard.sql` serializes
manual capture retries by workspace/provider/key. A replay succeeds only when
actor, project, event type, sensitivity, checksum, title, filename and MIME
match the original request. A scope or payload mismatch fails closed with an
idempotency conflict instead of returning a receipt from another project.

## Safety boundaries

- No verified memory is created by the load fixture.
- The live performance gate is read-only.
- Every call uses explicit canonical project `…4402`; there is no default or
  AISTROYKA fallback.
- Fixture rows are removed after the database concurrency check.
- No token, memory body, ciphertext, or response payload is printed.
- This slice does not change retrieval weights or widen ACL.

## Acceptance evidence required after merge

- PR CI and CodeQL green; latest Codex review has no unresolved finding.
- Trusted-main CI green, including ephemeral 60-operation soak plus agentic probes, concurrent
  routing/dedupe SQL, shared-memory E2E, live Edge retrieval, and live Control
  Center.
- Production migration applied only after the merged main checks are green.
- One Memory OS milestone with PR, merge SHA, CI identifiers, Recall@10,
  latency, routing/dedupe evidence, blockers, and read-after-write receipt.


## Weekly AI reconciliation — 2026-11-10

**Period:** 2026-11-03 through 2026-11-10. **Status:** planning-only, not implementation or deployment. Existing canonical IDs, P0 gates and historical records take precedence. Reconcile with currently open PRs and exact HEAD before marking any item DONE. Evidence = reproducible tests + independent review + SHA + deployment/device receipt where applicable. Source ideas: OpenAI engineering/CAD and agent safety, GitHub Xcode and review telemetry, AI Engineer talks on durable SDLC, factual numeric provenance, adaptive worker economics, rollback, memory validity, and new Anthropic/Meta model announcements. Vendor benchmarks are not local acceptance evidence.

| Priority | Existing workstream / ID | Incremental action and acceptance |
|---|---|---|
| P0 | M20 reliability/privacy/GA | Finish existing M20 security, RLS, disaster recovery, retrieval and production acceptance; preserve verified M19 ChatGPT↔Cursor integration. |
| P1 | Existing provenance / temporal model | Introduce or verify experience validity: event→outcome→verified lesson, applicability by repo SHA/tool version, expiry/revalidation, superseded/contradicted statuses; do not create a second memory. |
| P1 | Agent handoff evidence | Persist task/attempt IDs, source SHA, policy revision, permissions, tool actions, reviewer verdict, external-effect reconciliation and compensating action; ACL enforced on retrieval. |
| P2 | Knowledge comparison | Benchmark retrieval against alternative RAG approaches only after M20, without migrating the canonical store. |

**Implementation order:** close existing P0 first; P1 in bounded non-production pilots; P2 only after evidence-based decision. Owner: project engineering lead (assignment TBD); independent reviewer: ROMA/security or domain QA (assignment TBD). No auto-merge, production writes, payments or live trading from this roadmap update.

**Cross-project dependency:** Grow OS orchestrates; ROMA enforces independent policy/verification in Aistroyka-web; Sasha Memory OS stores permission-scoped evidence. Trading repository/runtime remains unverified; shared trading requirements are point-in-time market data, deterministic calculations, independent risk limits, exchange-state reconciliation, paper trading and kill switch, with no autonomous live orders.


### AI feature delta — 2026-11-11

These are **proposed additions to existing workstreams** from the November 11 intelligence review, not claims of shipped functionality or verified vendor capabilities. Validate official release/API/pricing availability before selecting any provider; independent exact-SHA acceptance and existing P0 gates remain mandatory.

- **P1 / training-data trust:** verified agent lessons are not automatically trusted fine-tuning examples; attach source, tool trace, approval, model/harness version, expiry, contamination/backdoor-test result and permission scope before export. Never train on raw untrusted prompt-injection text without review.
- **P1 / cross-modal continuity:** store consented voice/text/UI task handoffs under one durable ID and policy version; interrupted sessions preserve state without duplicating tool effects. Enforce project ACL and retention.
- **P2 / retrieval benchmark:** test new model candidates on same temporal/provenance tasks, avoiding claims that model performance replaces source integrity.

**Acceptance rule:** record baseline, owner, independent reviewer, test corpus, security/privacy gates, cost per verified task and explicit decision (adopt / defer / reject). No autonomous production actions or merge authorized by this documentation.


## Gap-only AI roadmap reconciliation — 2026-11-20

**Review period:** 2026-11-12–2026-11-20. Compared this branch with `main` and the existing Nov 10/11 reconciliation. Only incremental acceptance conditions and candidate evaluations are recorded; pre-existing capabilities must not be rebuilt. **PLANNING ONLY / NOT IMPLEMENTED / NOT MERGED.** The owner and independent reviewer remain TBD until assigned. Recheck exact HEAD, CI and production receipts before any DONE status.

| Priority | Existing owner / workstream | Newly identified gap / acceptance evidence |
|---|---|---|
| P0 | Existing M20 privacy / reliability / GA | Close outstanding trusted-main production and ACL/DR/performance gates before any new capability; M19 shared ChatGPT↔Cursor memory is already implemented. |
| P1 | Existing temporal provenance and agent history | Persist append-only task state changes, incident hypotheses, independent counterchecks, post-deploy verification, tool/model/skill version and exact source SHA with bounded retention; store evidence, not agent self-reported success. |
| P1 | Existing ACL / agent handoff | Validate transitive originator/recipient data restrictions across project/tenant and child-agent retrieval; stale, contradicted and superseded knowledge must not silently become authoritative. |
| P1 | Existing experience quality | Skill-eval outcomes and verified failure lessons must be versioned and revalidated after tool/model changes; raw external instructions never trusted as training examples. |

**Source references:** [OpenAI Performance Factory](https://openai.com/index/how-openai-performance-factory-keeps-chatgpt-fast/), [Google Mirror Dimension](https://blog.google/security/mirror-dimension-for-agents/), [OpenAI frontier risk controls](https://openai.com/index/managing-frontier-ai-risk/). Other recent model/vendor announcements are *candidates requiring independent availability and price validation*, not approved dependencies. No new runtime privileges, model installation, migrations, payments, deployment, PR merge, or trading orders are authorized by this document.


## Codex / Cursor execution delta — 2026-11-24

Planning only. Reconcile current main and active PRs first; preserve M19 shared memory and existing M20 gates. Vendor candidates require upstream verification.

- P0 existing M20 ACL/privacy: redact secrets before persistence and egress, final provider allowlist, retention verification, transitive principal/recipient restrictions, synthetic revocation drill.
- P1 existing retrieval: evaluate OmniEVIE-4B multimodal retrieval with page/time provenance, Recall@K, latency, ACL negatives and storage cost; no second memory store.
- P1 existing experience/evidence: version reusable task templates, LoRA/skill/model provenance, requirement-to-test receipts and independent verdict; distinguish NOT_RUN/UNKNOWN/FAIL; no raw untrusted traces as training data.

Codex/Cursor: map gaps to existing IDs, implement only missing functionality on separate branch, preserve tests, report exact SHA, independent verdict, reproducible tests and blockers. No auto-merge or production changes. Owner/reviewer TBD.


## Cursor execution specification — 2026-11-26

Planning-only delta for 25–26 November. Read current main and active implementation PRs first; map to existing IDs, implement only confirmed gaps. Vendor claims require primary-source verification. Existing P0 gates remain first. Proposed numerical thresholds are initial configurable test defaults, not measured results. No auto-merge, deployment, purchases, ad activation or live trading. Owner/reviewer TBD.

### P1 — existing M20 provenance / retrieval
Preserve M19 and current M20 gates. Extend existing evidence schema only if missing: skill/model/runtime version and hash, source first-available timestamp, observation timestamp, task/attempt ID, independent verdict, contradictory evidence and supersession. MCP task handoff retains ACL and consent; no secrets or untrusted skill instructions persisted as trusted memory. Test cross-tenant denial, replay, stale/superseded records, historical cutoff leakage and retrieval latency/Recall@K. Store model benchmark receipts from Growth with exact environment and cost; no second memory store.

### Cursor delivery contract
Work in a separate implementation branch; report gap matrix, changed files, reproducible commands, test receipts, exact commit SHA, independent verdict, rollback and remaining blockers. Never mark DONE from documentation/build alone. Stop on missing authorization, hardware access or provider compatibility; report NOT_RUN rather than fabricate evidence.


## Cursor / Codex execution delta — 2026-11-27

Planning-only extension to November 26 specification. Reconcile current main, active PRs and actual code before execution; map to existing IDs, implement only confirmed gaps. P0 blockers first. Vendor claims from daily digest require primary-source verification before adoption. Numerical corpus sizes are proposed test defaults, not measured results. Owner/reviewer TBD.

- P1 existing M20 consolidation: audit current memory lifecycle before implementation. Add proposal-only consolidation to existing pipeline if missing: detect contradictory/stale/repeatedly disproven memories, attach original evidence, propose correction/supersession with reason and scope; independent reviewer approves before trusted retrieval. Preserve audit history subject to retention/deletion policy, ACL, version and rollback; never rewrite security rules or silently elevate unverified traces.
- Acceptance: fixtures for false memory causing repeated failure, contradictory sources, stale version, cross-tenant denial, rejected proposal, approved supersession and rollback; measure retrieval correctness/Recall@K, latency and repeat failure rate before/after. Store three-run Model Arena receipts with functional/security verdicts and environment provenance. Preserve M19 and current M20 release gates.

Delivery: separate implementation branch, baseline and gap matrix, reproducible tests, exact SHA, independent verdict, rollback and blockers. No automatic merge, production deployment, purchases or live trading. Sources for verification: https://huggingface.co/nvidia/Nemotron-3.5-Parse ; https://onchainbench.ai/methodology ; https://www.perplexity.ai/en-GB/hub/blog/freeze-the-web-with-perplexity-time-machine ; https://openclaw.ai/blog/shellbench ; https://sakana.ai/marlin-update-2/ .

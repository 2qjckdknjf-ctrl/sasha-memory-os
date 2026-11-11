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

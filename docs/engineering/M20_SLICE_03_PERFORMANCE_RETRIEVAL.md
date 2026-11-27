# M20 Slice 03 — performance and retrieval quality gate

Status: **production PASS 2026-10-15**. PRs `#115`–`#117`, trusted-main CI
and CodeQL are green; exact seven-tool live MCP read-after-write passed with
steady-state p95 `1750 ms`. Memory OS receipt:
`1e618a29-8ba6-4da4-871a-d6530863cf2a`.

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

## Failure diagnostics — 2026-11-27

The live runner now emits one bounded `m20_live_retrieval_failure` JSON record
per failed attempt, followed by the existing failing summary and nonzero exit.
Only five fields are allowed: `sampleIndex`, `phase`, `failureClass`,
`httpStatus`, and `durationMs`. Index zero identifies the warm-up; indices
1–12 identify the default measured attempts. Phases distinguish a request that
did not return headers, response-body consumption, and response-contract checks.
Failure classes distinguish deadline timeout, other abort, transport error,
HTTP error, invalid JSON, JSON-RPC error, MCP tool error, and missing result.
HTTP status is null until headers have been received. No endpoint, project ID,
query, header, exception message/cause, or response content enters these records.

The defaults remain one warm-up plus 12 sequential samples, a 4,000 ms request
deadline and a 2,000 ms steady-state p95 limit. Any failed attempt, including
the warm-up, still fails the gate even if the successful samples meet p95.
There is no automatic retry or change to retrieval, ACL, SQL, or deployment.

The earlier run [45985923386](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/45985923386)
reported 11 successful measured samples, one failure and p95 1,751 ms, but did
not retain the failure category. A transport timeout is only a hypothesis for
that historical event. These diagnostics make future failures actionable;
they do not establish that the service incident has been repaired.

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

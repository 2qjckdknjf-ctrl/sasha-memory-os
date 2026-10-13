# M17 Slice 06 - Graph/hybrid fusion and frozen evaluations

Status: implemented; production Edge deployment and live acceptance follow merge and green CI.

Official pack version: `m17-s06-v1`

Roadmap sections: `17`, `graph-aware-retrieval`, `retrieval-evals`

## Goal

Combine the existing hybrid RRF result set with the bounded, ACL-filtered live
entity graph without changing the seven-action ChatGPT Mode A surface.

## Retrieval contract

- Existing `/v1/search` and `memory.search` accept the explicit optional mode
  `retrieval_mode: graph`. Hybrid remains the default and is unchanged.
- Graph mode requires one explicit project. There is no workspace-wide or
  AISTROYKA fallback.
- Entity seeds come from `api_search_entities`; traversal uses
  `api_graph_retrieve` with the frozen two-hop, 24-node, 48-edge and 0.7
  confidence limits from M17.5.
- Both live RPC responses must echo the requested project. A mismatch fails
  closed rather than fusing foreign data.
- Raw hybrid scores are normalized against the best hybrid hit before applying
  weights: hybrid `0.55`, graph `0.45`. This keeps RRF and graph confidence on
  compatible scales.
- A graph score can influence ranking only when the linked memory carries at
  least one non-empty provenance/evidence reference.
- If a safe seed is unavailable, graph mode returns the untouched hybrid order
  plus an explicit `hybrid-only` trace. It does not manufacture graph context.
- The response exposes seed entities, bounded traversal trace, stop reason,
  evidence references, component scores and fused score for inspection.

## ChatGPT Mode A

The public profile remains exactly seven actions. This slice adds one optional
enum field to the existing `memory.search` input; no eighth tool or privileged
write is introduced. Graph mode uses the same OAuth/API-secret validation,
subject binding and server-side service-role RPC boundary as ordinary search.

## Frozen evaluation

Fixture `m17-s06-v1` verifies three failure-sensitive cases:

- an evidence-backed graph relation promotes the relevant decision above a
  lexical distractor;
- an already-correct hybrid top result does not regress;
- a graph-only assertion without evidence never enters the ranked results.

The gate requires Recall@3 `1.0` on every case, aggregate MRR not below the
hybrid baseline (and strictly improved by the promotion case), deterministic
tie-breaking and evidence on every non-zero graph score. API tests also prove
that graph mode fails closed without a project/durable backend, does not invoke
graph RPCs in ordinary hybrid mode and preserves packed-context citation order.

## Deployment and live acceptance

No database migration is required; M17.5 already deployed the server-only graph
RPCs. After merge, deploy `memory-mcp`, run live `memory.search` in graph mode
against the canonical Sasha Memory OS project, verify an evidence-bearing fused
result and a no-seed hybrid fallback, then record the receipt in Memory OS.

## Next

`M18.1_CURSOR_BOOTSTRAP_CONTRACT`

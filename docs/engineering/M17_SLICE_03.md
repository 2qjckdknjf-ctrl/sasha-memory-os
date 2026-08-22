# M17 Slice 03 - Graph-aware retrieval

Status: bounded graph traversal fused with hybrid retrieval on M17.1–M17.2.

## Goal

Combine entity graph traversal with hybrid/agentic retrieval using bounded
hops/nodes/edges, evidence thresholds, and weighted fusion. No unbounded
multi-hop expansion.

Official pack version: `m17-s03-v1`

Roadmap sections: `17.3`, `graph-aware-retrieval`

## In scope

- `traverseGraphBounded`, `planGraphRetrieval`, `fuseGraphHybridHits`
- Golden traversal fixture (100% contract precision)
- Evidence threshold filtering on edges
- CURRENT_STATE tip update

## Out of scope

- Live graph DB traversal against Supabase
- Control Center entity inspector
- Memory backfill/migration

## Definition of Done

- Traversal respects hop/node/edge budgets
- Low-evidence edges excluded from traversal
- Graph+hybrid fusion produces ranked fused hits
- Live graph retrieval E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M17.4-entity-migration-backfill`

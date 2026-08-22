# M17 Slice 01 - Entity graph foundation

Status: first M17 contract slice after M16 Apple bridge completion.

## Goal

Establish the personal knowledge graph foundation: entity classes, typed
edges, stable IDs, merge/split policy, and provenance requirements for graph
assertions.

Official pack version: `m17-s01-v1`

Roadmap sections: `17`, `personal-knowledge-graph`

## In scope

- 18 entity classes and 12 edge types from the canonical plan
- `entityStableId`, `decideEntityMerge`, `decideEntitySplit`
- `validateGraphAssertion` with mandatory evidence
- Golden merge fixture (contract-level; live suite later)
- CURRENT_STATE tip update

## Out of scope

- Graph-aware retrieval (later M17 slice)
- Control Center entity inspector UI
- Live golden entity-resolution E2E
- Backfill/migration of existing memories

## Definition of Done

- Cross-project person/project merges blocked
- Graph assertions fail without evidence
- Live graph E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M17.2-entity-resolution`

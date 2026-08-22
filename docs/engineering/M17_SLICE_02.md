# M17 Slice 02 - Entity resolution

Status: cross-source entity resolution on top of M17.1 foundation.

## Goal

Resolve entity candidates across ChatGPT, GitHub, Drive, Gmail, Calendar, and
Apple with weighted signals, confidence thresholds, and fail-closed ambiguity
handling. No accidental cross-project person/project merges.

Official pack version: `m17-s02-v1`

Roadmap sections: `17.2`, `entity-resolution`

## In scope

- `resolveEntityCandidate` with source-specific signal kinds
- Golden resolution fixture (>=95% precision target)
- Cross-project scoped entity blocking
- CURRENT_STATE tip update

## Out of scope

- Graph-aware retrieval traversal
- Control Center entity inspector
- Live cross-connector resolution E2E

## Definition of Done

- Golden fixture >=95% precision
- Ambiguous/conflicting cases fail closed
- Live resolution E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M17.3-graph-retrieval`

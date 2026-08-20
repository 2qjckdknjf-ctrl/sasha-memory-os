# M13 Slice 05 - personalized importance

Status: implementation slice on top of M13 Slice 04 advanced contradiction detection.

## Goal

Add one bounded, additive personalized-importance layer on the existing stack so
retrieval can honor per-actor or project-default pin/importance adjustments
without changing global truth, widening ACL, or adding a new ChatGPT Mode A
tool.

## In scope

- Reuse the existing stack:
  - `MemoryRecord.importance`
  - hybrid retrieval / RRF in `packages/retrieval`
  - existing `POST /v1/search`
  - existing `memory.search`
  - existing audited memory review/update surfaces
- Require an explicit `project_id` for personalization writes.
- Support two scopes only:
  - actor-specific personalization for the caller
  - owner-set project default personalization
- Keep personalization project-scoped and ACL-safe:
  - ranking applies only after ACL-visible memories are selected
  - actor-specific pins never leak to other actors
  - personalization never raises sensitivity or surfaces hidden rows
- Keep writes additive, audited, and reversible:
  - no verified memory writes
  - no conflict auto-resolution
  - clear by sending a neutral personalization for the same scope
- Keep the slice bounded:
  - one memory personalization change per request
  - `importance_delta` limited to `[-0.5, 0.5]`
  - pin is boolean only
- Version the layer for reproducible ranking:
  - ranking version `hybrid-rrf+m13-s05-v1`
  - personalization payload version `m13-s05-v1`
- Keep ChatGPT Mode A at exactly 7 tools.

## Out of scope

- Replacing global `memory_records.importance`
- Learned ranking / training loops
- Graph / Graphiti work
- Calendar / Apple / new connector families
- New UI surfaces
- New ChatGPT Mode A tools
- Owner-token bypasses
- Production SQL apply

## Notes

- Actor personalization overrides project-default personalization for the same
  memory.
- Clearing an actor-specific override falls back to any project-default value
  instead of masking it.
- Pinned ranking is a post-ACL ordering boost, not a visibility bypass.

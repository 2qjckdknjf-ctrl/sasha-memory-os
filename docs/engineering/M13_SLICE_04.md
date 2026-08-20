# M13 Slice 04 - advanced contradiction detection

Status: implementation slice on top of M13 Slice 03 proactive consolidation.

## Goal

Add one bounded, additive contradiction detector on the existing stack so one
explicit project can persist durable candidate-conflict records for conflicting
memories without writing new verified truth.

## In scope

- Reuse the existing stack:
  - `packages/retrieval` conflict/dispute status handling
  - proactive consolidation planning
  - existing audit log
  - existing HTTP / MCP / worker consolidation paths
- Require an explicit `project_id`; never default to AISTROYKA.
- Keep all detection inside the requested project and caller ACL scope.
- Keep the detector bounded by:
  - scanned records
  - max detected pairs
  - max time
- Persist additive `memory_conflicts` candidate records only.
- Store evidence refs as memory ids + titles only.
- Audit each detected contradiction and the enclosing proactive run.
- Keep verified writes at zero.
- Keep ChatGPT Mode A at exactly 7 tools.

## Out of scope

- Auto-resolving conflicts to verified truth
- Writing new verified memories
- Deleting history or collapsing provenance
- Graph / Graphiti work
- Learned-ranking training
- New connector families
- New ChatGPT Mode A tools or profiles
- New UI surfaces
- Production SQL apply

## Notes

- The durable record is project-scoped and idempotent by conflict key.
- Contradiction persistence is additive: repeated detections refresh the record
  and increment detection count.
- Candidate groups from Slice 03 remain available; Slice 04 adds pairwise
  durable contradiction candidates for:
  - mutually incompatible current facts
  - disputed vs current facts
  - superseded vs current facts
  - corrected vs current facts

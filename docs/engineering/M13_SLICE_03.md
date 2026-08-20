# M13 Slice 03 - proactive consolidation

Status: implementation slice on top of M13 Slice 02 bounded multi-hop retrieval.

## Goal

Add one bounded, additive proactive consolidation pass on the existing stack so
consolidation can be scheduled or ticked for one explicit project without a
human invoking `consolidation.run` every time.

## In scope

- Reuse the existing consolidation surfaces:
  - `packages/retrieval/src/consolidate.ts`
  - MCP `consolidation.run`
  - existing consolidation worker / `processing_jobs` path
- Require an explicit `project_id` for proactive consolidation.
- Keep the run scoped to one explicit project and existing caller ACLs.
- Emit deterministic, bounded proactive results:
  - near-duplicate candidate merges
  - candidate conflicts
  - stop reason / exhaustion state
- Audit each proactive run with:
  - `runId`
  - rules version
  - input memory ids
  - applied merges
  - emitted candidate conflicts
- Lower retrieval weight of stale duplicate candidates by marking them
  `superseded`; keep history intact.
- Keep verified writes at zero for this slice.
- Keep ChatGPT Mode A at exactly 7 tools.
- Keep the project-scoped enqueue on the existing consolidation job/outbox path.

## Out of scope

- Graph / Graphiti work or learned ranking
- Auto-writing new verified memories
- Silent status promotion to verified
- Workspace-wide consolidation or cross-project merge
- New ChatGPT Mode A tools
- Full project-state projection rewrite or new UI surfaces
- Production SQL apply

## Notes

- This slice keeps manual `consolidation.run` available, but adds a proactive
  project-scoped branch instead of creating a parallel product surface.
- Candidate conflicts are emitted for review; they are not auto-promoted to
  verified truth.
- Run lineage is carried through the proactive run audit payload and the
  persisted supersede reason (`runId` + rules version).

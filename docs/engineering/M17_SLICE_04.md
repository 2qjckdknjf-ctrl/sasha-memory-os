# M17 Slice 04 - Entity graph migration and backfill

Status: durable Supabase entity graph plus an idempotent projection of existing
canonical memories.

Official pack version: `m17-s04-v1`

Roadmap sections: `17.4`, `entity-migration-backfill`

## Goal

Move M17.1-M17.3 from contract-only code to a real database projection without
rewriting memory IDs, source-event IDs, temporal history, or provenance.

## Schema

- `entities`: stable workspace-scoped identity, canonical name, class, status,
  confidence, validity, source reference and optional source memory/event.
- `entity_aliases`: normalized aliases with source evidence.
- `entity_edges`: the 12 canonical typed relationships, explicit project scope,
  temporal validity and mandatory evidence.
- `memory_entities`: evidence-bearing links from canonical memory to subject,
  project-context and source-account entities.

All four tables have forced RLS. Direct `anon` and `authenticated` table access
is revoked; the projection is maintained by trusted server runtime only.

## Backfill rules

- Every non-deleted memory with an effective project gets exactly one
  `project_context` link.
- Project routing uses `app.effective_memory_project_id`; a corrected memory is
  never projected back into its stale stored project.
- `decision`, `task`, and `idea` map losslessly to one stable entity per memory.
- Projects, structured repository metadata, and connector accounts receive
  stable entities.
- Deleted memories are excluded. Superseded/retracted direct entities remain as
  archived history.
- No entity class is guessed from free text.
- Re-running `app.api_backfill_entity_graph` is idempotent; stable entity IDs and
  edge idempotency keys prevent duplication.

## Verification

The mandatory ephemeral Supabase job applies the complete migration chain and
runs `tests/security/m17_slice_04_entity_graph_cases.sql`. It verifies:

- memory/source IDs remain unchanged;
- project-context coverage equals eligible memory count;
- aliases and edges retain source evidence;
- deleted memory does not enter the graph;
- effective project corrections are honored;
- a second backfill creates no extra entities, aliases, edges, or links;
- forced RLS and client-role revocations remain active.

Production is applied only after merge and green CI. The production acceptance
record must include row counts, coverage, idempotency re-run, security advisors,
and a traceable graph assertion before this slice is declared live.

## Out of scope

- Free-text NER or automatic person/company merging
- Control Center entity inspector UI
- Graph-aware production retrieval RPC/UI
- New ChatGPT MCP tools (Mode A remains exactly 7 tools)

## Next

`M17.5_GRAPH_INSPECTOR_LIVE_E2E`

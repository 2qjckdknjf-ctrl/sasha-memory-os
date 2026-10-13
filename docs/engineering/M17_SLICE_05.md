# M17 Slice 05 - Live graph retrieval and entity inspector

Status: implemented; production apply and live acceptance follow merge and green CI.

Official pack version: `m17-s05-v1`

Roadmap sections: `17.3`, `17.4`, `graph-aware-retrieval`, `entity-inspector`

## Goal

Expose the durable M17.4 projection through a fail-closed server API and make
its entities, relationships, memory links, and evidence inspectable in Control
Center.

## Server boundary

- `api_search_entities`: exact-project entity/alias search, maximum 50 results.
- `api_get_entity_graph`: one entity with aliases, typed edges, evidence and
  accessible linked memories, maximum 48 edges.
- `api_graph_retrieve`: evidence-bearing traversal bounded to 2 hops, 24 nodes,
  48 edges and up to 8 seeds; minimum accepted edge confidence is 0.7.
- Every RPC validates the API secret, binds the calling subject, requires an
  explicit project and evaluates the existing memory ACL.
- `anon` and `authenticated` cannot execute the RPCs or read graph tables
  directly. Only the server-side `service_role` can execute the public wrapper.
- Seeds and traversed endpoints must belong to the same project. There is no
  default project or cross-project fallback.

## Control Center

`Граф знаний` is a first-class route. The list view searches canonical names,
aliases and stable identifiers inside the selected project. The entity view
shows stable identity, confidence, aliases, inbound/outbound typed edges,
source references and linked memories. A bounded two-hop action exposes the
retrieval trace and its stop reason without changing the seven-tool ChatGPT
Mode A surface.

## Verification

Mandatory ephemeral Supabase CI runs
`tests/security/m17_slice_05_live_graph_cases.sql` after the M17.4 backfill case.
It proves:

- exact entity search and inspector evidence;
- linked memory/source-event provenance;
- bounded graph traversal and a traceable project edge;
- no cross-project nodes or foreign seed acceptance;
- hard rejection above canonical traversal budgets;
- no graph RPC execute grant for untrusted database roles.

Unit tests cover request validation, gateway RPC arguments, API fail-closed
behavior, navigation and the explicit-project UI state. Production acceptance
must rerun the backfill, execute all three RPCs against the canonical project,
rerun Supabase security/performance advisors and record a Memory OS milestone
with a read-after-write receipt.

## Out of scope

- New ChatGPT MCP tools; Mode A stays exactly seven tools.
- Unbounded natural-language entity extraction or automatic person merges.
- Fusion of graph scores into the existing `/v1/search` hybrid ranking. That is
  the next bounded slice and must retain evidence traces.
- Provider OAuth consent and Apple device E2E, which remain external blockers.

## Next

`M17.6_GRAPH_HYBRID_FUSION_EVALS`

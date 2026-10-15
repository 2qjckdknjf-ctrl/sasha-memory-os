# M19 — Control Center / governance completion

Pack: `m19-s01-v1`

## Goal

The owner can understand and control Sasha Memory OS without direct database access. The Control Center reuses the existing project, connector, review, graph, audit, privacy, and search surfaces and adds one owner-only governance route for missing system-wide operations.

## Mandatory surface map

| Canonical requirement | Owner surface | Evidence |
| --- | --- | --- |
| Overview health and freshness | `/governance` | `api_control_center_overview`, 24-hour freshness SLA |
| Projects and current-state snapshots | `/projects`, `/projects/:id` | existing project state and timeline APIs |
| Connector scope, sync, cursor, errors, revoke/reconnect | `/connections` | cursor metadata is visible; opaque values and token material stay hidden |
| UNCLASSIFIED inbox and routing corrections | `/governance#routing-inbox` | owner-only audited correction RPC; explicit target project and reason |
| Review, conflicts, candidate → verified | `/conflicts`, memory inspector | existing owner review flow and consolidation |
| Entity/knowledge graph inspector | `/entities`, `/entities/:id` | bounded evidence-aware traversal |
| Jobs, dead letters and replay | `/governance#job-queue` | bounded metadata-only list; existing dead-letter and connector replay controls |
| Audit trail | `/audit` | metadata-only owner audit feed |
| Privacy/export/delete/retention/sensitive sources | `/privacy`, `/transferred-objects` | explicit-project owner flows and checked-in retention guidance |
| Search/debug ranking evidence | `/search` | hybrid/graph trace and evidence refs without raw forbidden source payloads |

## Security invariants

- Governance reads and mutations are owner-only and require explicit workspace scope.
- Routing correction requires an explicit target project and a bounded human reason, and writes the existing audit event.
- Job and routing list responses omit raw memory content, idempotency keys, outbox payloads, OAuth tokens, vault material, and opaque cursor values.
- New database RPCs are executable only by `service_role`; `anon` and `authenticated` have no direct execution grants.
- Replay remains limited to dead-letter connector-sync jobs and rejects revoked/disabled connections.
- The owner surface contains no demo actor switch. Developer diagnostics remain isolated at `/ops`.
- Lists are bounded to 200 rows; the UI requests 50.

## Acceptance

- Schema pack, API integration, browser render, privilege-boundary, full repository, lint, and type tests pass.
- Ephemeral Supabase proves owner overview, non-owner denial, metadata-only UNCLASSIFIED listing, audited resolution, bounded dead-letter listing, and direct-role denial.
- After merge and green main CI, apply `20261015200000_m19_control_center_governance.sql`, run live owner reads and a reversible routing/job drill where safe, verify the browser route by interaction, then commit the live receipt before marking M19 complete.

## Production evidence — 2026-10-15

- Implementation PR `#110` merged as `965050bcf981e2e9b86a81d0c79e8bc6d2620b23`.
- PR CI `38776809143`, main CI `38777226702`, and main CodeQL `38777226855` passed.
- Production migration record: `20261015172818_m19_control_center_governance`.
- Live owner overview, UNCLASSIFIED inbox, and bounded job reads passed. Cursor and ChatGPT non-owner calls failed closed with `42501`; client roles have no direct RPC execution grants.
- Connection responses omit opaque cursor values. Job responses omit idempotency keys and payloads.
- A reversible production probe rejected a project from another workspace and removed both temporary records.
- Direct production RPC checks verified owner reads, non-owner denial, role grants, response redaction, and cross-workspace routing rejection.
- The first browser run (`38778955603` / job `116574576759`) is explicitly **not release evidence**: it ran against pull-request code and exposed the API secret through a `VITE_*` variable. Review rejected that design.
- The corrected gate runs only on a trusted `push` to `main` and injects the API secret in the Vite development proxy, never into browser JavaScript. Its production browser receipt must be recorded after this change merges and the main workflow passes.
- Preliminary Memory OS receipt `1cb2e53b-93eb-481e-8cd3-6cfcc4da534f` was read back, but must be superseded by a corrected receipt after the trusted-main gate passes.

Operational facts exposed by the completed surface are intentionally not hidden: five connectors require OAuth reauthorization, one is revoked, four old jobs remain failed, 142 August connector jobs are dead-lettered, and five non-terminal capture/notification outbox events have no downstream publisher policy yet. The worker cycle `38779484728` passed without unsafe replay; these items move to M20/external-provider closure rather than being misreported as healthy.

Current status: **IMPLEMENTED / FINAL TRUSTED-MAIN LIVE GATE PENDING**. The canonical next slice remains M19 until the corrected receipt is committed.

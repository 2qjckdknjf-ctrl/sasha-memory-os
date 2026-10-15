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

Current status: implementation in progress; production live acceptance is not yet claimed.

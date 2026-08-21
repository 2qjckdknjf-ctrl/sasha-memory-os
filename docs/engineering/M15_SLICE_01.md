# M15 Slice 01 - unified source-event ingestion contract

Status: implementation slice on top of M14.1 baseline reconciliation and the
canonical completion plan (`SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21`).

## Goal

Normalize every inbound source into one immutable `source_events` contract with
idempotent replay safety across webhook, polling, and agent adapters.

Official pack version: `m15-s01-v1`

Roadmap sections: `15.1`, `universal-ingestion`

## In scope

- Canonical envelope schema 1.1 (backward compatible with 1.0 bodies)
- Adapter normalizers: webhook, polling, agent
- Additive DB columns: `external_id`, `external_version`, `change_state`,
  `ingestion_adapter`, `envelope_schema_version`
- Single Postgres RPC `app.api_ingest_source_event` (idempotent insert)
- Wire `POST /v1/ingestion/events` to Supabase when gateway is available
- Pack/fixture/docs + drift updates in `CURRENT_STATE`

## Out of scope

- M15.2 connector orchestration / recovery loops
- Automatic project routing (M15.3)
- Canonicalization / dedupe / supersession (M15.4)
- Freshness engine (M15.5)
- Live connector E2E against production accounts (recorded as later gate)
- New ChatGPT Mode A tools
- Default/`MEMORY_OS_DEFAULT_PROJECT_ID` write fallback
- Production SQL apply from this PR alone (migration is checked in; remote apply
  is an explicit deploy step)

## Definition of Done

- Duplicate delivery/replay with the same idempotency key resolves to one
  logical `source_events` row.
- Adapters refuse missing explicit `project_id` (fail closed).
- Pack tests + schema/adapter unit tests pass.
- ChatGPT Mode A remains exactly 7 tools.

## Notes

- Existing capture RPCs remain available; this slice adds the unified ingest
  path without deleting prior capture helpers.
- Deletion/revoke is represented as `change_state` on the event; memory
  tombstone convergence remains M15.6.

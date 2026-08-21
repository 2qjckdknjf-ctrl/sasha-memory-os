# M15 Slice 05 - freshness / reconciliation

Status: implementation slice on top of M15.1–M15.4.

## Goal

Detect stale source sync, stale project snapshots vs newer source observations,
stale cursors, and stalled workers — then clear alerts after repair.

Official pack version: `m15-s05-v1`

Roadmap sections: `15.5`, `freshness-reconciliation`

## In scope

- Watermark model + SLA defaults per source
- `evaluateSourceFreshness` / `evaluateWorkerFreshness` / `reconcileFreshnessAlerts`
- Fixture proofs for stale detection and post-repair clear
- Explicit live E2E blocker (not PASS from mocks)
- CURRENT_STATE tip update

## Out of scope

- Full Control Center freshness dashboard UI (M19)
- Live connector credential E2E
- Deletion/revoke lifecycle (M15.6)
- Changing ChatGPT Mode A tools

## Definition of Done

- Controlled stale fixtures produce alerts within SLA
- Alerts clear after repaired watermarks
- Live freshness E2E recorded as BLOCKED, not PASS
- Mode A remains 7 tools

## Next

`M15.6-deletion-revoke-lifecycle`

# M15 Slice 02 - continuous connector orchestration

Status: implementation slice on top of M15.1 source-event contract.

## Goal

Make continuous connector orchestration explicit: scheduler ownership, recovery
ordering, and the four mandatory recovery scenarios — without silently marking
live E2E PASS from mocks.

Official pack version: `m15-s02-v1`

Roadmap sections: `15.2`, `continuous-connector-orchestration`

## In scope

- Official orchestration pack `m15-s02-v1` with recovery order and DoD scenarios
- Thin `planConnectorOrchestrationTick` planner in `workers/connector-sync`
- Fixture proofs for:
  - connector restart / resync reclaim
  - duplicate event idempotency
  - missed webhook bounded reconcile
  - token expiry → bounded resync
- Fail closed if a repair reports silent data loss
- Update CURRENT_STATE / README / drift for M15.2 tip
- Explicit live E2E blocker documentation

## Out of scope

- Claiming live GitHub/Drive/Gmail/Calendar E2E PASS without credentials
- Drive watch create/renew production lifecycle
- Full agent writeback event matrix (beyond existing MCP capture/decision paths)
- New ChatGPT Mode A tools
- Default project_id fallback
- Production SQL apply beyond already-checked-in migrations

## Definition of Done (this slice)

- Pack + fixture + unit orchestration tick PASS
- Live orchestration E2E recorded as **BLOCKED** (missing live credentials /
  remote apply), not PASS
- ChatGPT Mode A remains 7 tools

## Next

`M15.3-project-entity-routing` after live orchestration blockers are closed or
explicitly accepted as deferred with a superseding verified decision.

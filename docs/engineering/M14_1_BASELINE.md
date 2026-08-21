# M14.1 — Baseline reconciliation

Status: Phase 0 / M14.1 of the canonical completion plan
(`SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100% — 2026-08-21`).

## Goal

Establish one truthful current state before M15 feature work: main tip, README,
roadmap docs, deployment inventory, open PRs, and a machine-readable
`CURRENT_STATE` snapshot must agree.

Official manifest version: `m14.1-v1`

## In scope

- Publish `docs/engineering/CURRENT_STATE.json` (milestone, SHA reconciled
  against, schema/migration tip, packs, deployments, workers, connectors,
  blockers, next slice).
- Update root README status from stale M7-era tip wording to post-M14 + M14.1.
- Add automated drift checks that fail CI when CURRENT_STATE / README claim
  impossible or obsolete milestone metadata.
- Verify writes do not silently apply `MEMORY_OS_DEFAULT_PROJECT_ID`.
- Audit draft PR #16; fold still-useful Cursor Cloud toolchain notes into
  `AGENTS.md` and close #16 as superseded (not active roadmap).

## Out of scope

- M15 source-event ingestion contract (next slice).
- New connectors, live revoke/restore, production SQL apply.
- Changing ChatGPT Mode A tool count or contract.
- Enabling Fly hosted API.

## Definition of Done

- Main/docs/`CURRENT_STATE` agree on current milestone and deploy inventory.
- No ambiguous default-project routing remains advertised as a write fallback.
- No stale open PR is treated as active roadmap work.
- `CURRENT_STATE` is retrievable from the repo by ChatGPT and Cursor
  (`docs/engineering/CURRENT_STATE.json`).

## Drift checks (mechanical)

See `apps/api/src/currentStateDrift.ts` and
`tests/security/m14_1_baseline_pack.test.ts`.

## Next slice

`M15.1-source-event-contract`

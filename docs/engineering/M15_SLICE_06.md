# M15 Slice 06 - deletion / revoke lifecycle

Status: implementation slice on top of M15.1–M15.5.

## Goal

Converge source `delete`/`revoke` and connection revoke into shared tombstone /
stop-sync / retention actions, with reconnect that does not create uncontrolled
duplicates. Prove fixture end-to-end convergence with privacy tests.

Official pack version: `m15-s06-v1`

Roadmap sections: `15.6`, `deletion-revoke-lifecycle`

## In scope

- `planSourceLifecycleActions` for upsert/delete/revoke
- `planConnectionRevoke` (stop sync immediately + tombstone handoff)
- `planReconnect` provenance-key guard
- Fixture simulation applicator + convergence helper
- CURRENT_STATE tip update
- Explicit live provider revoke E2E blocker (not PASS from mocks)

## Out of scope

- New privacy product or parallel delete stack (reuse existing routes/workers)
- Live provider credential E2E
- Autonomous capture policy (M15.7)
- Changing ChatGPT Mode A tools

## Definition of Done

- Delete removes object from active set while preserving audit metadata
- Revoke stops sync, tombstones, and expires derived when policy requires
- Reconnect with same provenance key does not invent a second canonical row
- Live E2E recorded as blocked; fixture convergence PASS
- Mode A remains 7 tools

## Next

`M15.7-autonomous-capture-policy`

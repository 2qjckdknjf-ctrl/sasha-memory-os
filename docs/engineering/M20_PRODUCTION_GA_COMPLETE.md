# M20 — Production / GA complete (residual ops)

Status: contract packs through M20.4 are LIVE PASS. This document freezes the
production/GA exit for the canonical completion plan and lists residual
operational blockers that do not reopen the pack sequence.

## Completed live gates

| Gate | Pack | Evidence |
|------|------|----------|
| M20.1 security | `m20-s01-v1` | RLS/RPC hardening, threat model, leaked-password protection |
| M20.2 reliability/DR | `m20-s02-v1` | Backup inventory + ephemeral restore/retry/DLQ drills in CI |
| M20.3 performance/retrieval | `m20-s03-v1` | Recall@10, soak, live Edge p95 receipt `1e618a29-…` |
| M20.4 privacy/compliance | `m20-s04-v1` | PR #118, migration `20261126222340_…`, receipt `8c5a8399-…` |

Mode A remains exactly seven tools. Shared ChatGPT↔Cursor E2E remains PASS
(2026-10-13). M19 Control Center trusted-main live pass remains PASS.

## Residual ops blockers (do not invent new pack slices)

1. Real provider OAuth credentials/consent for M15 live connector E2E
2. Non-terminal outbox publisher policy (5 pending events)
3. Rotate stale GitHub `SUPABASE_ACCESS_TOKEN` for Auth hardening workflow
4. Apple live device E2E (companion signing / PhotoKit / EventKit)
5. Vector-in-public advisor relocation (deferred, planned separately)
6. Fly hosted API remains deferred while Edge MCP is primary

## Definition of done for this tip

- `CURRENT_STATE` tip is `m20-privacy-compliance-live-pass`
- `completedThrough` / `contractPacksCompletedThrough` is `M20.4`
- `nextSlice` / `nextAllowedSlice` is `M20_PRODUCTION_GA_COMPLETE`
- Live privacy receipt is frozen and drift-checked
- No claim of PASS for residual blockers above

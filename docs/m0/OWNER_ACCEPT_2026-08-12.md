# Owner accept record — RG0

**Date:** 2026-08-12  
**Actor:** Owner (Sasha) via explicit instruction to accept RG0 gates.

## Decisions

| Gate | Decision |
|---|---|
| V1 / OUT boundaries | **Accepted** as in [SCOPE.md](./SCOPE.md) |
| Region | **`eu-central-1`** (live `sasha-memory-os`) |
| Data classes A–F + retention table | **Accepted** ([DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md)) |
| Threat model / DPIA residual risks | **Accepted** for alpha; formal DPIA when volume grows |
| Risk register | **Accepted**; no unknown blockers for M6/M9/M11 |
| Eval baseline | **Accepted** (golden 200 + CI + hosted workers) |
| Backlog M1–M3 | **Accepted** as planning baseline |
| ChatGPT MCP | **B now** (MCP/HTTP read + Web/HTTP write). **A preferred** when ChatGPT workspace supports custom MCP write. Fallback B accepted. |
| Pilot project | Seed project `44444444-4444-4444-8444-444444444401` (demo Slice / Memory OS pilot) |
| Connector scope default | **Selected** labels/files (not full mailbox/Drive) |
| Fly full HTTP API | **Deferred** — owner decision 2026-08-12: not needed now; keep deploy scaffold for later |

## Effect

RG0 exit gate **owner-accept side closed**. Hosted ops stay on Supabase Edge + GH Node workers.

If a public Node API is needed later:

```bash
flyctl auth login   # or: export FLY_API_TOKEN=...
./scripts/fly-deploy-api.sh
```

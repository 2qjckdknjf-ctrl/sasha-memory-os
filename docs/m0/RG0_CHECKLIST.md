# RG0 checklist

Exit gate: unknown external blockers cleared; owner accepts V1/OUT; scope/risk/eval/backlog exist.

**Status: OWNER ACCEPTED 2026-08-12** — [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md).

## Landed in-repo (alpha)

| Item | Evidence |
|---|---|
| ADR-001..005 | `docs/adr/` |
| Environment + secrets policy | `docs/engineering/ENVIRONMENT_MATRIX.md`, `SECRETS_POLICY.md` |
| RLS matrix + tests | `docs/engineering/RLS_MATRIX.md`, `tests/security/`, remote RLS smoke |
| Golden retrieval 200 | `tests/eval/golden_retrieval.*` |
| Demo slice | `docs/engineering/DEMO_SLICE.md` |
| Live Supabase EU | `docs/engineering/SUPABASE.md` (`eu-central-1`) |
| Hosted ops ticks | Edge `worker-ticks` v2 + GH `Worker ticks` / `Worker node ticks` |
| Data classes / retention | [DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md) |
| Threat model / DPIA | [THREAT_MODEL_DPIA.md](./THREAT_MODEL_DPIA.md) |
| ChatGPT MCP plan + HTTP `/mcp` | [CHATGPT_MCP_PLAN.md](./CHATGPT_MCP_PLAN.md), [MCP_CURSOR.md](../engineering/MCP_CURSOR.md) |
| Staging promote runbook | [STAGING_PROMOTE.md](../engineering/STAGING_PROMOTE.md) |
| Risk register | [RISK_REGISTER.md](./RISK_REGISTER.md) |
| Eval plan | [EVAL_PLAN.md](./EVAL_PLAN.md) |
| Backlog M1–M3 | [BACKLOG_M1_M3.md](./BACKLOG_M1_M3.md) |
| Owner accept record | [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md) |

## Owner decisions

| Item | Status |
|---|---|
| Accept V1 / OUT boundaries | **Accepted** |
| Accept region + retention + data classes | **Accepted** (`eu-central-1`) |
| Accept threat/DPIA residual risks | **Accepted** (alpha) |
| Accept risk register + no unknown blockers | **Accepted** |
| Accept eval baseline + M1–M3 backlog | **Accepted** |
| ChatGPT MCP capability | **B now**; **A preferred** when write MCP available |
| Optional: host full HTTP API on Fly | Attempt when `flyctl` auth / `FLY_API_TOKEN` available |

## Explicitly not blocking RG0

- Fly full API (ops covered by Edge + Node GH workers)  
- Dims 1536 default (column + path landed; opt-in via env)  
- Apple companion / Photos full index (V1 backlog / OUT)

# RG0 checklist

Exit gate: unknown external blockers cleared; owner accepts V1/OUT; scope/risk/eval/backlog exist.

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
| Data classes / retention (draft) | [DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md) |
| Threat model / DPIA (draft) | [THREAT_MODEL_DPIA.md](./THREAT_MODEL_DPIA.md) |
| ChatGPT MCP plan | [CHATGPT_MCP_PLAN.md](./CHATGPT_MCP_PLAN.md) |
| Risk register | [RISK_REGISTER.md](./RISK_REGISTER.md) |
| Eval plan | [EVAL_PLAN.md](./EVAL_PLAN.md) |
| Backlog M1–M3 | [BACKLOG_M1_M3.md](./BACKLOG_M1_M3.md) |

## Owner decisions still required

| Item | Doc |
|---|---|
| Accept V1 / OUT boundaries | [SCOPE.md](./SCOPE.md) |
| Accept region + retention + data classes | [DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md) |
| Accept threat/DPIA residual risks | [THREAT_MODEL_DPIA.md](./THREAT_MODEL_DPIA.md) |
| Accept risk register + no unknown blockers | [RISK_REGISTER.md](./RISK_REGISTER.md) |
| Accept eval baseline + M1–M3 backlog | [EVAL_PLAN.md](./EVAL_PLAN.md), [BACKLOG_M1_M3.md](./BACKLOG_M1_M3.md) |
| Confirm ChatGPT MCP capability A or B | [CHATGPT_MCP_PLAN.md](./CHATGPT_MCP_PLAN.md) |
| Optional: host full HTTP API on Fly | `scripts/fly-deploy-api.sh` (login required) |

## Explicitly not blocking RG0 code path

- Fly full API (ops covered by Edge + Node GH workers)  
- Dims 1536 default (column + path landed; opt-in via env)  
- Apple companion / Photos full index (V1 backlog / OUT)

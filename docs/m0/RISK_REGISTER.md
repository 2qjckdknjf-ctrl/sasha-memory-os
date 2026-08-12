# Risk register (RG0)

Status: **owner accepted 2026-08-12**. Complements [THREAT_MODEL_DPIA.md](./THREAT_MODEL_DPIA.md).

Scoring: Impact / Likelihood = L(1–3) × I(1–3). Residual after current alpha mitigations.

| ID | Risk | L | I | Score | Mitigation (now) | Owner action |
|---|---|---|---|---|---|---|
| R1 | ChatGPT custom MCP write unavailable | 2 | 2 | 4 | Fallback B/D (Web/HTTP); plan in [CHATGPT_MCP_PLAN.md](./CHATGPT_MCP_PLAN.md) | Confirm A vs B |
| R2 | OpenAI embeddings leave EU | 2 | 2 | 4 | `MEMORY_OS_EMBED_ENGINE=stub` / disable OpenAI | Accept residual or force stub in prod |
| R3 | API secret / vault key leak | 1 | 3 | 3 | Server-only secrets; GH encrypted; no commit | Rotate on suspect; keep out of logs |
| R4 | Connector over-ingest (full mailbox) | 2 | 2 | 4 | Selected scopes preferred; stub/auto pull modes | Keep selected labels/files for V1 |
| R5 | RLS/ACL regression | 1 | 3 | 3 | Golden 200 + RLS tests + remote smoke | Gate merges on CI |
| R6 | Worker/outbox stall | 2 | 2 | 4 | Edge ticks + Node GH workers + dead-letter | Watch GH Actions + health |
| R7 | No Fly full HTTP API | 2 | 1 | 2 | Edge + Node workers cover ops | Optional Fly when auth available |
| R8 | Wrong cloud project / region | 1 | 3 | 3 | Dedicated `sasha-memory-os` `eu-central-1` | Never reuse AISTROYKA/HiAir |
| R9 | Supersede/consolidation false merge | 2 | 2 | 4 | Title+embed plan; owner review queue | Tunable thresholds in M4+ |
| R10 | Apple companion / Photos delay | 3 | 1 | 3 | Explicit V1 backlog / OUT for full index | Do not block Core |

## External dependencies (known)

| Dependency | Blocks | Status |
|---|---|---|
| ChatGPT workspace MCP capability | Preferred write path | Known; fallback exists → not unknown blocker for M6/M9/M11 |
| Fly auth (optional) | Full hosted Node HTTP API | Ops covered without Fly |
| OpenAI (optional) | HQ embeddings | Stub path works |
| Google/GitHub OAuth apps | Live connector pulls | Per-connection; pilot scopes |

## Owner accept

- [x] Risk table accepted  
- [x] No unknown external blocker for M6/M9/M11  
- [x] Residual scores accepted or amended

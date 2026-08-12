# Threat model + initial DPIA (RG0)

Status: **initial draft for owner review** — not a legal sign-off.

## System summary

Sasha Memory OS stores long-term personal/work memory for a private owner and selected agents (ChatGPT, Cursor, future ROMA). Control plane: HTTP API, MCP gateway, Web demo, Supabase Postgres (EU), vault-backed connectors, GH-scheduled workers + Edge ticks.

## Data subjects / purposes

| Subject | Purpose |
|---|---|
| Owner (primary) | Canonical memory, review, connectors, export later |
| Agent actors (ChatGPT/Cursor) | Scoped read/write under ACL |
| Third-party content authors | Incidental in mail/docs/calendar — minimized via selected sync |

Lawful basis (proposed): legitimate interest / consent for personal productivity memory; owner controls connectors and sensitivity.

## Assets

1. Canonical memories + embeddings  
2. OAuth tokens in vault  
3. API secret / vault key / service role  
4. Outbox / jobs (side-channel of activity)  
5. Web/MCP session binding (`x-subject-id`, auth bind)

## Top threats (STRIDE-lite)

| ID | Threat | Mitigation (landed / planned) |
|---|---|---|
| T1 | Stolen `MEMORY_OS_API_SECRET` → owner ops | Secret only server-side; required outside local/test; rotate via env |
| T2 | Token leakage in DB | Vault refs only; `supabase_vault` KMS path available |
| T3 | Cross-subject read | RLS + `app.has_acl`; golden forbidden-access cases |
| T4 | SSRF via link capture | DNS/private IP blocks; no credentialed URLs |
| T5 | Prompt/agent over-share | Sensitivity + project ACL; no dangerous writes by default |
| T6 | Stale connector jobs / orphan outbox | Idempotent enqueue; dead-letter cron |
| T7 | Embed provider exfil | Optional OpenAI; stub locally; dims controlled |
| T8 | Supply-chain / wrong Supabase project | Dedicated `sasha-memory-os`; never AISTROYKA/HiAir |

## DPIA checklist (initial)

| Question | Alpha answer |
|---|---|
| What data? | See [DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md) |
| Why? | External Memory Core for multi-agent continuity |
| Necessity? | Only captured/synced scopes; not full-device scrape |
| Risks to owner? | Sensitive facts, mail, calendar if connected |
| Measures? | ACL/RLS, vault, API secret, EU region, audit/outbox |
| Retention? | Table in data classes doc |
| Third countries? | Embeddings may call OpenAI if enabled — document/disable for strict EU-only |
| Rights? | Retract/dispute/status + owner `GET /v1/export/memories` (alpha) |

## Residual risks (owner must accept)

1. OpenAI embeddings / Whisper leave EU when `MEMORY_OS_EMBED_ENGINE=openai` or `MEMORY_OS_TRANSCRIBE_ENGINE=openai`.  
2. Full Node API not yet on Fly — ops via Edge + GH Node workers (authenticated secrets).  
3. ChatGPT custom MCP write may be unavailable → Web/MCP stdio fallback.

## Owner accept

- [ ] Threat table accepted  
- [ ] Residual risks accepted or mitigated by config (e.g. embed=stub)  
- [ ] DPIA promoted to formal review if/when personal data volume grows

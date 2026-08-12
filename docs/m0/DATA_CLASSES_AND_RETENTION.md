# Data classes, region, retention (RG0)

Status: **owner accepted 2026-08-12** — see [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md).

## Region / residency

| Item | Decision |
|---|---|
| Primary region | `eu-central-1` (Frankfurt) — live project `sasha-memory-os` |
| Rationale | EU residency preference from baseline; single region for V1 alpha |
| Separate EU-only residency product | Out of V1; revisit if legal requires stricter isolation |

## Data classes

| Class | Examples | Storage | Default ACL |
|---|---|---|---|
| **A — Identity / ACL** | subjects, memberships, auth binds | Postgres (`app`/public via RPCs) | Owner + membership |
| **B — Canonical memory** | facts, decisions, preferences, project state | `memory_records` + evidence | Project ACL + sensitivity |
| **C — Capture / quarantine** | raw text/doc/link artifacts, checksums, chunks | artifacts + storage paths | Workspace write actors |
| **D — Connector secrets** | OAuth access/refresh | Vault (`supabase` ciphertext or `supabase_vault` KMS) — **refs only in Postgres** | Service / owner ops |
| **E — Ops / audit** | outbox, processing jobs, audit events | Postgres | Owner ops + service |
| **F — Embeddings** | `embedding` jsonb + `embedding_vector` / `_hq` | Postgres + pgvector | Same as parent memory |

Sensitivity labels (existing): `public` | `internal` | `confidential` | `restricted` (enforced via ACL helpers / RLS matrix).

## Retention (V1 alpha defaults)

| Data | Retention | Notes |
|---|---|---|
| Active / verified memories | Indefinite until owner retract/delete | Superseded stay for provenance |
| Candidate memories | 90 days without review → consolidation/dead-letter pressure | Workers + outbox stale jobs |
| Quarantine artifacts (raw capture) | 180 days | Checksum + evidence may outlive raw blob |
| Outbox published events | 30 days after `published_at` | Ops recovery window |
| Dead-letter jobs | 90 days | Manual ack / purge |
| OAuth vault secrets | Until connection revoke | Revoke deletes vault ref payload |
| Audit log | 365 days | Baseline compliance floor |
| Raw chat transcripts as memory | **Not default** | Only explicit capture / connector scopes |

## Pilot volumes (alpha)

| Source | Scope |
|---|---|
| Manual / Web / MCP capture | Owner + ChatGPT demo subjects |
| GitHub / Gmail / Drive / Calendar | Connected accounts only; selected labels/files preferred over full mailbox |
| Golden retrieval | 200 ACL-aware cases (landed) |

## Owner accept

- [x] Region `eu-central-1` accepted for V1 alpha/prod path  
- [x] Data classes A–F accepted  
- [x] Retention table accepted (or amended in ADR)

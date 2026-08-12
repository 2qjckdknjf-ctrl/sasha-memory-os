# Backlog M1–M3 (RG0)

Maps baseline milestones to alpha reality. **Done** = landed enough for demo/RG0; remaining items stay on path to full milestone exit.

Architecture context: ADRs `docs/adr/`, [DEMO_SLICE.md](../engineering/DEMO_SLICE.md), [SUPABASE.md](../engineering/SUPABASE.md).

## M1 — Platform foundation

| Item | Status | Notes |
|---|---|---|
| Monorepo + CI | Done | `pnpm` workspaces, GitHub Actions CI |
| Env matrix / secrets policy | Done | engineering docs |
| Migrations + seed | Done | Live Supabase EU |
| Queue / outbox abstraction | Done (V1 alpha) | Postgres outbox + jobs |
| Object / artifact storage paths | Partial | Quarantine + checksum; bucket hardening later |
| Staging one-command deploy | Done (ops path) | Edge + GH workers; Fly API deferred (scaffold only) |
| Staging promote runbook | Done | [STAGING_PROMOTE.md](../engineering/STAGING_PROMOTE.md) |
| Remote MCP HTTP | Done (alpha) | `POST /mcp` on API + `start:http` |
| Tracing/logging runbooks | Partial | request-id + JSON HTTP logs; OTel later |
| Dependency audit in CI | Done | `pnpm audit --audit-level=critical` |

**M1 exit remaining:** distributed tracing later. Fly HTTP API deferred (not blocking).

## M2 — Event store, provenance, access

| Item | Status | Notes |
|---|---|---|
| Subjects / projects / ACL | Done | Seed + auth.bind |
| Source events / artifacts / evidence | Done (alpha) | Capture + connectors |
| RLS matrix + negative tests | Done | security + golden forbidden |
| Idempotency + outbox | Done | Minute buckets / dead-letter |
| Temporal fields / revisions | Partial | Status/supersede; full temporal model continues |
| Audit viewer | Stub | Web timeline / outbox / export download |

| Owner JSON export | Done (alpha) | `GET /v1/export/memories` (secret outside local) |
| Temporal list filters | Done (alpha) | `recorded_after` / `recorded_before` on list + export |

**M2 exit remaining:** audit viewer polish (timeline already covers ops alpha).

## M3 — Universal ingestion V1

| Item | Status | Notes |
|---|---|---|
| Text / document / link capture | Done (alpha) | API + MCP + Web |
| Quarantine + hash/dedup | Done | SHA-256 |
| PDF/DOCX + OCR adapters | Done (alpha) | Engines present |
| SSRF-safe link fetch | Done | Tests |
| Chunks + job status | Done | process_now / jobs |
| Audio transcription | Done (alpha) | `stub|fixture|openai` (Whisper) |
| Poison-file isolation suite | Done (alpha) | oversized/empty/unsupported + SSRF link deny |
| Job status UI | Done (alpha) | Web load/process + MCP `jobs.get` |

**M3 exit remaining:** job UI polish only if product needs richer history; production Whisper key ops.

## Ordered next (post-RG0)

1. ~~Owner accept RG0~~  
2. ~~Fly full API~~ — deferred  
3. ~~M4 review UX~~ — selective apply + bulk approve/dispute + MCP `extraction.run`  
4. M5 retrieval polish — RRF hybrid + authority + context packer + temporal search (alpha landing); apply `search_rrf_temporal` remotely when Supabase MCP/CLI available  
5. M6 ChatGPT remote A when workspace ready  

## Owner accept

- [x] Backlog M1–M3 accepted as planning baseline  
- [x] Post-RG0 order above accepted (or amended) — see [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md)

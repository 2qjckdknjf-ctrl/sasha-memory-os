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
| Staging one-command deploy | Partial | Edge + GH workers live; Fly API optional |
| Staging promote runbook | Done | [STAGING_PROMOTE.md](../engineering/STAGING_PROMOTE.md) |
| Remote MCP HTTP | Done (alpha) | `POST /mcp` on API + `start:http` |
| Tracing/logging runbooks | Partial | request-id + JSON HTTP logs; OTel later |
| Dependency audit in CI | Done | `pnpm audit --audit-level=critical` |

**M1 exit remaining:** optional Fly HTTP API; distributed tracing later.

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
| Audio transcription | Not started | Adapter later |
| Poison-file isolation suite | Partial | Basic; expand acceptance suite |

**M3 exit remaining:** audio adapter; fuller format/poison suite; job UI completeness.

## Ordered next (post-RG0 owner accept)

1. Owner accept RG0 docs (scope / retention / risks / MCP A|B).  
2. Optional Fly full API.  
3. Close M1 remaining (promote runbook + observability).  
4. M2 temporal/export polish.  
5. M3 audio + poison suite → then M4 Memory Core depth (extraction LLM, review UX).

## Owner accept

- [ ] Backlog M1–M3 accepted as planning baseline  
- [ ] Post-RG0 order above accepted (or amended)

# Test / eval plan (RG0)

Status: **active harness** — owner accepts as V1 alpha eval baseline.

## Goals

1. Retrieval quality under ACL (allow + forbid).  
2. No cross-subject leakage.  
3. Regression gate for Core / connectors / consolidation.

## Suites

| Suite | Location | Gate |
|---|---|---|
| Unit / package | `packages/*`, `apps/*`, `workers/*`, `connectors/*` | CI `test` |
| Typecheck | monorepo | CI `typecheck` |
| RLS / security | `tests/security/` | CI + remote smoke |
| Golden retrieval | `tests/eval/golden_retrieval.*` | **200** hybrid ACL cases |
| API smoke | `scripts/smoke-api.sh` | Local / staging |
| Hosted ticks | GH `Worker ticks`, `Worker node ticks` | Scheduled success |

## Golden retrieval (WP-07)

- Cases: 200 (`gr-001`…).  
- Actors: owner / chatgpt / cursor with project ACL + sensitivity.  
- Ranking: hybrid (FTS + vector when embeddings present).  
- Forbidden-access cases must return empty / non-leak.

Run:

```bash
npx pnpm@9.15.9 test -- tests/eval/golden_retrieval.test.ts
```

## Staging / live checks

1. Edge health: `…/functions/v1/worker-ticks/health` → `version: 2`.  
2. Node workers: workflow dispatch consolidate + connector-sync.  
3. Optional: `MEMORY_OS_API_BASE_URL=… ./scripts/smoke-api.sh` when full HTTP API hosted.

## Not yet eval-gated (tracked)

- Extraction LLM quality (needs provider contract).  
- End-to-end ChatGPT custom MCP (depends on workspace capability A/B).  
- Full Photos / Apple companion (OUT / later).

## Owner accept

- [ ] 200 golden + CI suites accepted as RG0 eval baseline  
- [ ] Hosted worker success accepted as ops health signal

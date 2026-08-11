# Supabase project — Sasha Memory OS

Dedicated project (ADR-005). **Do not** mix with AISTROYKA / HiAir.

| Field | Value |
|---|---|
| Name | `sasha-memory-os` |
| Project ref | `vpxblcxsvlylqyldiuwr` |
| Region | `eu-central-1` |
| API URL | `https://vpxblcxsvlylqyldiuwr.supabase.co` |
| Dashboard | https://supabase.com/dashboard/project/vpxblcxsvlylqyldiuwr |
| Cost | ~$10/month (confirmed at create) |

## Applied migrations

- `extensions` … `rls_*`, `api_rpcs`, `api_upsert_project_state`
- `connector_registry`
- `text_capture_ingestion` (+ digest/bytea fix)
- `capture_document_metadata` / event-type branch for text vs document
- `subjects_and_connections_actions`
- `oauth_broker_and_auth_binding` (vault refs + auth user bind)
- `oauth_exchange_metadata` / `oauth_http_exchange` (peek state, `exchanged` mode)
- `memory_embeddings` (jsonb + `vector(32)` HNSW + `api_set_memory_embedding`)
- `search_hybrid_vector` (`api_search_memories` accepts optional query embedding)
- `supersede_memory` (consolidation RPC `api_supersede_memory`)
- `shared_connector_vault` (`api_vault_put|get|delete`)
- `list_memories_embedding` (expose embedding on review/consolidation list)
- `consolidation_outbox` (`api_enqueue_consolidation` / `api_complete_consolidation`)
- `outbox_claim_dead_letter` (`api_list_outbox_pending` / `api_dead_letter_stale_jobs`)
- `publish_outbox_event` (`api_publish_outbox_event`)
- `vault_ref_enqueue_idempotent` (list connections `vaultRef`; enqueue outbox only on new jobs)
- `consolidation_enqueue_idempotent` (one consolidate outbox per minute-bucket)

Seed loaded: workspace `sasha-home`, project `aistroyka`, verified decision + state v1.

## Local env

Copy `.env.example` → `.env` and fill:

- `MEMORY_OS_SUPABASE_ANON_KEY` / publishable key
- `MEMORY_OS_API_SECRET` — must match `app.runtime_config.api_secret`

API talks to Postgres through `public.api_*` RPCs (SECURITY DEFINER + ACL).  
The browser never receives the API secret; only `apps/api` does.

```bash
npx pnpm@9.15.9 dev:api   # http://localhost:8787 backend=supabase
npx pnpm@9.15.9 dev:web   # http://localhost:5173
```

Never commit `service_role` or `MEMORY_OS_API_SECRET`.

## Remote smoke tests

With `.env` loaded, `apps/api` vitest runs:

- `src/supabase.rls.test.ts` — ACL/RLS probes
- `src/supabase.rpcs.test.ts` — vault put/get/delete, consolidation outbox (enqueue→list→complete), embed + hybrid search
- Owner catch-up: `POST /v1/memories/:id/embed`, `POST /v1/memories/embed-missing` (also MCP + Web + GH worker-ticks); full text via `api_get_memory` (list truncates to 500)
- HQ embeddings: `embedding_vector_hq vector(1536)` when `MEMORY_OS_OPENAI_EMBED_DIMS=1536`
- KMS vault: `MEMORY_OS_VAULT_BACKEND=supabase_vault` → `api_vault_kms_*` (supabase_vault extension)
- Hosted cron edge: `supabase/functions/worker-ticks` (GH `worker-ticks.yml`)

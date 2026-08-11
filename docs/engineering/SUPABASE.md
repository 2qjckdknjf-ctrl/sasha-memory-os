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

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

- `extensions`
- `identity`
- `projects_events_artifacts`
- `memory_core`
- `audit_jobs_outbox`
- `rls_helpers`
- `rls_policies`
- `fix_app_function_search_path`

Seed loaded: workspace `sasha-home`, project `aistroyka`, verified decision + state v1.

## Local env

Copy `.env.example` → `.env` and fill publishable/anon key from the dashboard (or MCP `get_publishable_keys`).  
Never commit `service_role`.

# Supabase

Versioned migrations, RLS policies, and edge functions for Sasha Memory OS.

Use a **dedicated** Supabase project per environment. Do not share production databases with AISTROYKA, HiAir, or other products.

## Layout

- `migrations/` — WP-02 schema, RLS helpers/policies
- `seed.sql` — synthetic workspace (AISTROYKA demo decision/state)
- `config.toml` — local stack ports

## Apply (when CLI/Docker available)

```bash
supabase start
supabase db reset   # migrations + seed
psql "$DATABASE_URL" -f tests/security/rls_policy_cases.sql
```

Until then, the TypeScript demo slice exercises the same contracts in-memory.

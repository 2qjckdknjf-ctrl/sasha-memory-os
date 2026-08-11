# Sasha Memory OS

Внешняя каноническая долговременная память, общая для ChatGPT, Cursor, ROMA и будущих агентов: единый Memory Core с ACL, temporal model и provenance.

## Документация

- [Техническое задание и roadmap (baseline v1.0)](docs/baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md)
- [Карта документов](docs/README.md)
- [M0 scope](docs/m0/SCOPE.md)
- [ADRs](docs/adr/README.md)
- [Environment matrix](docs/engineering/ENVIRONMENT_MATRIX.md)
- [Secrets policy](docs/engineering/SECRETS_POLICY.md)
- [RLS matrix](docs/engineering/RLS_MATRIX.md)
- [Demo slice](docs/engineering/DEMO_SLICE.md)

## Статус

**Dedicated Supabase live** — project `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, `eu-central-1`). Details: [docs/engineering/SUPABASE.md](docs/engineering/SUPABASE.md).

- WP-01 bootstrap done
- WP-02 migrations + RLS + seed applied remotely
- WP-03…08 alpha: schemas, in-memory API/MCP, retrieval stub
- Web timeline UI: `apps/web` (`pnpm --filter @memory-os/web dev`)

## Репозиторий

```bash
npx pnpm@9.15.9 install
npx pnpm@9.15.9 typecheck
npx pnpm@9.15.9 test
npx pnpm@9.15.9 dev:api
npx pnpm@9.15.9 dev:web
```

API uses Supabase RPCs + `MEMORY_OS_API_SECRET` (see `.env`). Web talks to API on `:8787`.

## Auth headers (demo)

- `x-subject-id` — subject UUID
- `x-actor-key` — `owner` / `chatgpt` / `cursor`
- `x-client-id` — `demo-owner` / `demo-chatgpt` / `demo-cursor`
- `x-auth-user-id` — Supabase Auth user UUID (after `POST /v1/auth/bind`)

OAuth broker (stub): `POST /v1/oauth/start` → `POST /v1/oauth/callback` stores **vault refs only** (never tokens).

## Следующий шаг

- Set `MEMORY_OS_OAUTH_GITHUB_CLIENT_ID` / `MEMORY_OS_OAUTH_GOOGLE_CLIENT_ID` (+ vault/KMS) for real broker token exchange
- Expand golden retrieval set toward 100–200 cases (40 seeded now)
- Replace GitHub/Drive/Gmail/Calendar stub deltas with vault-backed provider pulls
- Real OAuth token exchange into KMS/vault (CLIENT_ID alone is not enough)

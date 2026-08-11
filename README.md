# Sasha Memory OS

Внешняя каноническая долговременная память, общая для ChatGPT, Cursor, ROMA и будущих агентов: единый Memory Core с ACL, temporal model и provenance.

## Документация

- [Техническое задание и roadmap (baseline v1.0)](docs/baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md)
- [Карта документов](docs/README.md)
- [M0 scope](docs/m0/SCOPE.md)
- [ADRs](docs/adr/README.md)
- [Environment matrix](docs/engineering/ENVIRONMENT_MATRIX.md)
- [Secrets policy](docs/engineering/SECRETS_POLICY.md)

## Статус

**WP-01 bootstrap** — monorepo skeleton, ADR-001..005, CI smoke, governance docs.

Реализация Memory Core / MCP / connectors ещё не начата.

## Репозиторий

pnpm workspaces. Layout — baseline §4.4 (`apps/`, `workers/`, `packages/`, `connectors/`, `supabase/`, `tests/`).

```bash
pnpm install
pnpm typecheck
pnpm test
```

## Следующий шаг

**WP-02** — Database and RLS foundation (migrations, RLS matrix, policy tests, synthetic seed).

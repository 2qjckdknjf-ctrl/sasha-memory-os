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

**WP-01…WP-08 alpha slice** in progress:

- WP-01 bootstrap done
- WP-02 SQL migrations + RLS + seed (apply when Supabase local works)
- WP-03 ingestion/job schemas + idempotent event store (in-memory + SQL)
- WP-05/06 typed memory + project state + handoff (domain + API)
- WP-07 retrieval stub
- WP-08 MCP gateway alpha tools

## Репозиторий

```bash
npx pnpm@9.15.9 install
npx pnpm@9.15.9 typecheck
npx pnpm@9.15.9 test
```

## Следующий шаг

- Поднять dedicated Supabase project (не AISTROYKA/HiAir) и применить migrations
- Починить arm64 Supabase CLI / Docker
- Web timeline UI поверх `/v1/projects/:id/context` + handoffs

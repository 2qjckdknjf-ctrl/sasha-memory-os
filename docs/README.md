# Документация Sasha Memory OS

## Карта

| Путь | Назначение |
|---|---|
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md) | Утверждённый baseline: ТЗ, архитектура, roadmap, acceptance |
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx) | Та же версия в Word |
| [baseline/architecture.png](baseline/architecture.png) | Обзорная архитектурная схема |
| [baseline/ingestion-flow.png](baseline/ingestion-flow.png) | Universal ingestion pipeline |
| [m0/SCOPE.md](m0/SCOPE.md) | Краткий scope M0 / RG0 и первые work packages |
| [adr/](adr/) | Architecture Decision Records |
| [engineering/ENVIRONMENT_MATRIX.md](engineering/ENVIRONMENT_MATRIX.md) | local / dev / staging / prod |
| [engineering/SECRETS_POLICY.md](engineering/SECRETS_POLICY.md) | Хранение и запреты для secrets |
| [engineering/RLS_MATRIX.md](engineering/RLS_MATRIX.md) | RLS / ACL matrix и negative cases |
| [engineering/DEMO_SLICE.md](engineering/DEMO_SLICE.md) | decision → state → MCP → handoff |
| [engineering/SUPABASE.md](engineering/SUPABASE.md) | Live project ref, region, migrations |

## Правило изменений

Baseline — канонический источник требований. Если реализация расходится с документом, изменение оформляется как ADR с причиной и влиянием на безопасность, данные, совместимость и roadmap.

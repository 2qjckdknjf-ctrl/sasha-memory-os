# Документация Sasha Memory OS

## Карта

| Путь | Назначение |
|---|---|
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md) | Утверждённый baseline: ТЗ, архитектура, roadmap, acceptance |
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx) | Та же версия в Word |
| [baseline/architecture.png](baseline/architecture.png) | Обзорная архитектурная схема |
| [baseline/ingestion-flow.png](baseline/ingestion-flow.png) | Universal ingestion pipeline |
| [m0/SCOPE.md](m0/SCOPE.md) | Краткий scope M0 / RG0 и первые work packages |
| [m0/RG0_CHECKLIST.md](m0/RG0_CHECKLIST.md) | RG0 gate tracker |
| [m0/DATA_CLASSES_AND_RETENTION.md](m0/DATA_CLASSES_AND_RETENTION.md) | Region, data classes, retention |
| [m0/THREAT_MODEL_DPIA.md](m0/THREAT_MODEL_DPIA.md) | Initial threat model / DPIA |
| [m0/CHATGPT_MCP_PLAN.md](m0/CHATGPT_MCP_PLAN.md) | ChatGPT MCP capability + fallbacks |
| [m0/RISK_REGISTER.md](m0/RISK_REGISTER.md) | RG0 risk register |
| [m0/EVAL_PLAN.md](m0/EVAL_PLAN.md) | Test / eval plan |
| [m0/BACKLOG_M1_M3.md](m0/BACKLOG_M1_M3.md) | Backlog M1–M3 vs alpha |
| [engineering/STAGING_PROMOTE.md](engineering/STAGING_PROMOTE.md) | Staging promote runbook |
| [engineering/MCP_CURSOR.md](engineering/MCP_CURSOR.md) | MCP stdio + HTTP |
| [adr/](adr/) | Architecture Decision Records |
| [engineering/ENVIRONMENT_MATRIX.md](engineering/ENVIRONMENT_MATRIX.md) | local / dev / staging / prod |
| [engineering/SECRETS_POLICY.md](engineering/SECRETS_POLICY.md) | Хранение и запреты для secrets |
| [engineering/RLS_MATRIX.md](engineering/RLS_MATRIX.md) | RLS / ACL matrix и negative cases |
| [engineering/DEMO_SLICE.md](engineering/DEMO_SLICE.md) | decision → state → MCP → handoff |
| [engineering/SUPABASE.md](engineering/SUPABASE.md) | Live project ref, region, migrations |
| [engineering/MCP_CURSOR.md](engineering/MCP_CURSOR.md) | MCP stdio gateway for Cursor / Claude Desktop |

## Правило изменений

Baseline — канонический источник требований. Если реализация расходится с документом, изменение оформляется как ADR с причиной и влиянием на безопасность, данные, совместимость и roadmap.

# Документация Sasha Memory OS

## Карта

| Путь | Назначение |
|---|---|
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.md) | Утверждённый baseline: ТЗ, архитектура, roadmap, acceptance |
| [baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx](baseline/Sasha_Memory_OS_Technical_Roadmap_and_Spec_RU.docx) | Та же версия в Word |
| [baseline/architecture.png](baseline/architecture.png) | Обзорная архитектурная схема |
| [baseline/ingestion-flow.png](baseline/ingestion-flow.png) | Universal ingestion pipeline |
| [m0/SCOPE.md](m0/SCOPE.md) | Краткий scope M0 / RG0 и первые work packages |
| [m0/RG0_CHECKLIST.md](m0/RG0_CHECKLIST.md) | RG0 gate tracker (owner accepted 2026-08-12) |
| [m0/OWNER_ACCEPT_2026-08-12.md](m0/OWNER_ACCEPT_2026-08-12.md) | Owner accept record |
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
| [engineering/CURRENT_STATE.json](engineering/CURRENT_STATE.json) | Machine-readable current milestone / deploy / blocker snapshot (`m14.1-v1`) |
| [engineering/M14_1_BASELINE.md](engineering/M14_1_BASELINE.md) | M14.1 Phase 0 baseline reconciliation |
| [engineering/M15_SLICE_01.md](engineering/M15_SLICE_01.md) | M15 Slice 01: unified source-event ingestion contract |
| [engineering/M15_SLICE_02.md](engineering/M15_SLICE_02.md) | M15 Slice 02: continuous connector orchestration pack |
| [engineering/M15_SLICE_03.md](engineering/M15_SLICE_03.md) | M15 Slice 03: automatic project / entity routing |
| [engineering/M15_SLICE_04.md](engineering/M15_SLICE_04.md) | M15 Slice 04: canonicalization / dedupe / supersession |
| [engineering/M15_SLICE_05.md](engineering/M15_SLICE_05.md) | M15 Slice 05: freshness / reconciliation |
| [engineering/M15_SLICE_06.md](engineering/M15_SLICE_06.md) | M15 Slice 06: deletion / revoke lifecycle |
| [engineering/M15_SLICE_07.md](engineering/M15_SLICE_07.md) | M15 Slice 07: autonomous capture policy |
| [engineering/M14_DOC_CATALOG.md](engineering/M14_DOC_CATALOG.md) | Versioned GA doc catalog for current official surfaces |
| [engineering/ONBOARDING.md](engineering/ONBOARDING.md) | First-hour onboarding guide on current MCP + Control Center surfaces |
| [engineering/M14_SLICE_05.md](engineering/M14_SLICE_05.md) | M14 Slice 05: incident runbook pack |
| [engineering/M14_SLICE_10.md](engineering/M14_SLICE_10.md) | M14 Slice 10: bounded support / ops surface pack |
| [engineering/runbooks/](engineering/runbooks/) | Checked-in incident runbooks for alert ownership, revoke, and rotation |
| [engineering/DEMO_SLICE.md](engineering/DEMO_SLICE.md) | decision → state → MCP → handoff |
| [engineering/SUPABASE.md](engineering/SUPABASE.md) | Live project ref, region, migrations |
| [engineering/MCP_CURSOR.md](engineering/MCP_CURSOR.md) | MCP stdio gateway for Cursor / Claude Desktop |

## Правило изменений

Baseline — канонический источник требований. Если реализация расходится с документом, изменение оформляется как ADR с причиной и влиянием на безопасность, данные, совместимость и roadmap.

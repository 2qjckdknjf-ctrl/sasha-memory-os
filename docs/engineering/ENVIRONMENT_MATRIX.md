# Environment matrix

Related: [ADR-005](../adr/ADR-005-secrets-and-environments.md), baseline §24.4.

| Environment | Purpose | Supabase | Data allowed | Deploy trigger |
|---|---|---|---|---|
| **local** | Developer laptop; synthetic fixtures | Local Supabase CLI or personal disposable project | Synthetic / anonymized only | Manual `pnpm` scripts |
| **development** | Shared integration; fake/provider sandboxes | Dedicated Memory OS **dev** project | Non-production test accounts and fixtures | Push to `main` or dedicated `develop` (when remote exists) |
| **staging** | Production-like RLS, indexes, queues, OAuth test apps | Dedicated Memory OS **staging** project | Staging OAuth + synthetic pilot data; no uncontrolled prod copies | CI on release candidate / manual promote |
| **production** | Private beta / GA | Dedicated Memory OS **prod** project | Real owner data under privacy policy | Explicit promote after release gates |

## Notable runtime flags

| Variable | Notes |
|---|---|
| `MEMORY_OS_MCP_PROFILE` | `full` (default) or `chatgpt` — ChatGPT pilot tool allowlist + default subject/workspace only; writes keep explicit `project_id` |
| `MEMORY_OS_CHATGPT_SUBJECT_ID` | Override ChatGPT demo subject for MCP defaults |
| `MEMORY_OS_DEFAULT_WORKSPACE_ID` | May fill `workspace_id` when the ChatGPT MCP profile omits it |
| `MEMORY_OS_DEFAULT_PROJECT_ID` | Ignored for MCP/write/export/privacy fallback; writes must pass explicit `project_id` |

## Rules

1. Memory OS projects are **never** shared with AISTROYKA, HiAir, or other product production databases.
2. Production data is not copied to lower environments without anonymization.
3. Each environment has its own secrets set (see [SECRETS_POLICY.md](SECRETS_POLICY.md)).
4. Schema changes ship only via versioned migrations under `supabase/migrations/`.
5. Staging is required before production for RLS, MCP, and connector changes that touch auth or data access.

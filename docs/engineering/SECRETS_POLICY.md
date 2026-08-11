# Secrets policy

Related: [ADR-005](../adr/ADR-005-secrets-and-environments.md), baseline §16.4.

## Allowed stores

| Secret class | Store | Notes |
|---|---|---|
| Supabase URL / anon key | Env / platform secrets | Safe for client apps with RLS |
| Supabase `service_role` | Server-only vault / CI secrets | Never shipped to Web/PWA/companion |
| Connector OAuth refresh tokens | Vault/KMS; DB holds reference | Refresh only in connector runtime |
| Webhook signing secrets | Vault/KMS | Verify before JSON side effects |
| LLM / OCR / embedding API keys | Server env / vault | Not in browser bundles |
| MCP client credentials | Per-environment secret store | Audience-bound where supported |

## Naming

Prefer `MEMORY_OS_<ENV>_<NAME>` or platform-native names documented in `.env.example`. Do not reuse secret names across environments.

## Forbidden

- Committing `.env`, credential JSON, PEM keys, or token dumps.
- Logging tokens, authorization codes, or raw sensitive payloads.
- Passing `service_role` to MCP clients, browsers, or mobile apps.
- Sharing production secrets with staging or local.

## Rotation and revoke

- Document owner and rotation cadence per secret class before private beta.
- Connector revoke must stop jobs/webhooks immediately, then apply retention.
- Compromised `service_role` or vault key: rotate, invalidate sessions, audit access logs.

## Repository hygiene

- `.env` and `.env.*` are gitignored; commit only `.env.example` with placeholders.
- CI must fail secret-scan checks when added (M1 hardening); until then, manual review on PRs.

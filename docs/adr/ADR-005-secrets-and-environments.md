# ADR-005: Secrets and environment isolation

- **Status:** Accepted
- **Date:** 2026-08-11
- **Baseline:** §0.4, §16.4, §17.5, §24.4

## Context

Connector tokens, webhook secrets, and Supabase `service_role` must not leak via repo, logs, clients, or mixed product databases.

## Decision

- Use **separate Supabase projects** for development, staging, and production. Never mix with AISTROYKA, HiAir, or other product production databases.
- Store provider tokens and webhook secrets in a managed vault/KMS; the database holds **references only**.
- Web/PWA and Apple companion never receive `service_role`.
- Local `.env` files are gitignored; only `.env.example` with non-secret placeholders may be committed.
- Logs, traces, and CI output must redact tokens, authorization codes, and sensitive payloads.

Detailed rules: [SECRETS_POLICY.md](../engineering/SECRETS_POLICY.md) and [ENVIRONMENT_MATRIX.md](../engineering/ENVIRONMENT_MATRIX.md).

## Consequences

- Environment promotion is migration- and secret-driven, not “copy prod DB to laptop.”
- Rotation and emergency revoke runbooks are required before private beta.
- Slightly higher ops overhead; required for RG0/RG5 privacy and DR posture.

## Security and roadmap impact

- Blocks accidental cross-product data mixing.
- Prerequisite for connector OAuth (M8+) and ChatGPT/Cursor MCP credentials (M6).

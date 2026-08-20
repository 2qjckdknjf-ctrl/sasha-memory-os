# Incident runbook: emergency revoke

Owner: Security on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Provide immediate containment guidance when a connector token, webhook secret,
or related credential is suspected to be compromised.

## Preconditions

- Any live write/admin/revoke action still requires an explicit `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.
- Coordinate with Connector on-call before any re-enable.

## Alerts covered

- `security.connector-token-compromised`

## Steps

1. Classify the compromised surface and confirm the affected connection id.
2. Stop jobs/webhooks immediately by moving to the connector revoke flow on the
   existing stack.
3. Freeze further replay/resync until the new credential is issued.
4. Hand off to the relevant owner for replacement credentials and retention
   cleanup.

## Rollback / revoke

- Revoke the compromised path first; do not rollback to a compromised token or
  webhook secret.
- Keep the revoke in place until owner approval confirms a fresh secret and a
  bounded recovery path.

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Record only the affected connector id, connection id, request id, and
  explicit `project_id`.
- If you need raw provider evidence, collect it outside the app telemetry path
  and only with owner approval.

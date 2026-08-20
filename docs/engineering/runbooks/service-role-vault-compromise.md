# Incident runbook: service_role or vault key compromise

Owner: Security on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Contain suspected privilege escalation involving the Supabase `service_role` or
the vault/KMS path that protects connector and webhook credentials.

## Preconditions

- Any live write/admin/revoke action still requires an explicit `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.
- Use the current stack only; do not perform live production actions as part of
  this slice.

## Alerts covered

- `security.acl.leakage`

## Steps

1. Rotate the compromised `service_role` or vault key on the current
   environment plan.
2. Invalidate sessions that depended on the compromised secret or privilege.
3. Audit access logs, request ids, and connector audit trails for the exposure
   window.
4. Re-run bounded health checks only after the new secret is active.

## Rollback / revoke

- Revoke the compromised credential path immediately; do not rollback to the
  compromised secret.
- If the replacement path is not ready, keep the restricted posture in place
  until owner approval confirms the safer recovery path.

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Store only timestamps, ids, affected surfaces, and owner decisions.
- Keep raw access-log payloads and credential material outside app telemetry.

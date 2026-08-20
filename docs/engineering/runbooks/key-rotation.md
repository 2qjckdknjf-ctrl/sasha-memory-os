# Incident runbook: key rotation

Owner: Security on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Document the bounded key-rotation path required before beta for secrets that
already exist on the current stack.

## Preconditions

- Keep a documented rotation cadence for each secret class referenced in
  `docs/engineering/SECRETS_POLICY.md`.
- Rotate in the vault first, then update the runtime that reads the secret.
- Any write/admin/revoke verification step still requires an explicit
  `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.

## Alerts covered

- `security.secrets.rotation-overdue`

## Steps

1. Identify the secret class and current owner.
2. Rotate the secret in the vault first and record the rotation window.
3. Update the bounded runtime or connector configuration that references the
   new secret.
4. Validate health on the existing stack without pasting secret material into
   any log, alert, or ticket.
5. Retire the previous secret only after the new path is confirmed healthy.

## Rollback / revoke

- If verification fails, rollback the runtime reference to the previous
  non-compromised secret while the vault record stays under Security on-call.
- If compromise is suspected instead of routine rotation, revoke the old secret
  and continue with `emergency-revoke.md`; do not reactivate a compromised key.

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Store only timestamps, owners, secret class, and request ids.
- Never paste secret values, session cookies, or connector payloads.

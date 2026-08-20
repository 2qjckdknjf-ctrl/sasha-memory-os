# Incident runbook: connector revoke and stop sync

Owner: Connector on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Use the current connector revoke surface to contain a compromised connection on
the existing stack.

## Preconditions

- The live revoke path is `POST /v1/connections/:id/revoke`.
- Any live write/admin/revoke action still requires an explicit `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.

## Alerts covered

- `security.connector-token-compromised`

## Steps

1. Confirm the affected connection id and explicit `project_id`.
2. Call `POST /v1/connections/:id/revoke` on the existing API surface.
3. Verify the revoke makes the affected connection stop jobs/webhooks immediately.
4. Apply retention through the existing privacy or connector cleanup path; do
   not invent a parallel deletion flow.

## Rollback / revoke

- Revoke remains the primary containment step; do not rollback to the revoked
  credential.
- Re-enable only after a fresh credential is bound and owner approval confirms
  the connector is safe to resume.

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Log connection ids, job ids, request ids, and explicit `project_id` only.
- Keep provider payload inspection outside the telemetry path.

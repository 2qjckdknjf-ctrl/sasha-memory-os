# Incident runbook: alert ownership and routing

Owner: Platform on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Keep every current official alert on an explicit owner and a checked-in
runbook without inventing a new pager product or a new ops UI.

## Preconditions

- Use existing surfaces only: current API routes, existing webhook docs, and
  the rollback guidance in `docs/engineering/STAGING_PROMOTE.md`.
- Any write/admin/revoke step still requires an explicit `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.

## Triage

- Confirm the alert is metadata-only and link by request id, connection id, job
  id, workspace id, and explicit `project_id`.
- Route platform latency or availability alerts to Platform on-call first.
- Route connector delivery regressions to Connector on-call.
- Route ACL or secret-compromise indicators to Security on-call.

## Alerts covered

- `slo.api.availability`
- `slo.mcp.availability`
- `slo.project.state`
- `slo.search.hybrid`
- `slo.search.agentic`
- `slo.write.receipt`

## Rollback / revoke

- For platform deploy regressions, use the existing rollback path in
  `docs/engineering/STAGING_PROMOTE.md`; production rollback is still outside
  this slice and still requires owner approval.
- For suspected secret or connector compromise, revoke access only through the
  linked incident runbooks below; do not improvise a new surface.

## Linked runbooks

- `key-rotation.md`
- `emergency-revoke.md`
- `connector-revoke-stop-sync.md`
- `webhook-dlq-replay-resync.md`
- `service-role-vault-compromise.md`

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Use ids, timestamps, route names, and status codes only.
- If a responder needs raw content, stop and get owner approval before any
  out-of-band handling.

# Incident runbook: webhook DLQ, replay, and resync

Owner: Connector on-call

Roadmap sections: `16.4`, `20.17`

## Purpose

Recover bounded webhook delivery incidents on the current stack without adding
new tooling.

## Preconditions

- Use existing API surfaces only:
  - `POST /v1/jobs/dead-letter-stale`
  - `POST /v1/jobs/:id/replay`
  - `POST /v1/connections/:id/resync`
  - `POST /v1/connections/:id/github/reconcile`
- Any live write/admin/revoke action still requires an explicit `project_id`.
- Do not fall back to `MEMORY_OS_DEFAULT_PROJECT_ID` or AISTROYKA.

## Alerts covered

- `slo.webhook.ack`

## Steps

1. Confirm the affected connector, connection id, and explicit `project_id`.
2. Use `POST /v1/jobs/dead-letter-stale` to classify stale work before replay.
3. Use `POST /v1/jobs/:id/replay` for a bounded dead-letter retry.
4. Use `POST /v1/connections/:id/resync` when cursors must be replayed from a
   known safe checkpoint.
5. Use `POST /v1/connections/:id/github/reconcile` only for the documented
   GitHub missed-delivery path.

## Rollback / revoke

- If the incident is caused by a compromised credential or endpoint, stop the
  replay path and revoke the connection instead of rolling forward blindly.
- Keep replay/resync disabled until the revoke or rollback decision is owned
  and approved.

## Telemetry hygiene

Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.

- Use job ids, connection ids, request ids, delivery ids, and explicit
  `project_id` only.
- Keep raw webhook bodies out of incident telemetry and PR comments.

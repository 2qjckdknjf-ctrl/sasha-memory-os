# M12 Slice 04 - ROMA audited notifications

## In scope

- One additive durable notification path on the existing `processing_jobs` / `outbox_events` / audit stack.
- Project-scoped notifications for successful `roma_project_health` and `roma_project_findings` completion only.
- ROMA-authored notification records with explicit `project_id`, source job/memory IDs, bounded title/severity/status metadata, unread state, and replay-safe idempotency.
- One internal outbox event per inserted notification record for a later delivery slice to consume.

## Out of scope

- Notifications inbox UI, approval UI, approval checkpoints, or action budgets.
- Email, Slack, push, Calendar watch, Apple, or extra Gmail/Drive/GitHub delivery/connectors.
- Any ChatGPT MCP Mode A tool changes.
- Any production apply or rollout changes.

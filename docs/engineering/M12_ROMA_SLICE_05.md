# M12 Slice 05 - ROMA approval checkpoints

## In scope

- One additive approval checkpoint path for ROMA QA finding writes on one explicit `project_id`.
- Durable `approval_checkpoints` rows with `requested_by`, `execution_subject_id`, owner decision state, expiry, audit, and outbox events.
- Owner-only approve/deny decisions without inventing a second operator identity before that principal exists in schema.
- Approve writes the bounded QA finding as ROMA; deny/expire fail closed and write nothing.
- Replay-safe idempotent approve that returns the existing memory/audit IDs instead of double-writing.

## Out of scope

- Approval UI, notifications inbox UI, or delivery fan-out (email, Slack, push).
- Action budgets, Calendar watch, Apple, or extra Gmail/Drive/GitHub slices.
- Retrofitting every existing ROMA job path; this slice adds one bounded checkpoint type for QA findings.
- Any ChatGPT MCP Mode A tool changes.
- Any production apply or rollout changes.

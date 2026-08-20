# M12 Slice 03 - ROMA audited QA findings

## In scope

- One additive bounded enqueue path for `roma_project_findings` on the existing `processing_jobs` / `outbox_events` stack.
- Execution under the ROMA service subject only for one explicit `project_id`.
- Project-scoped QA finding memories with severity, status, provenance, source IDs/titles only, and audit events.
- Idempotent replay-safe writes that fail closed if ROMA loses the required ACLs.

## Out of scope

- Findings UI, notifications, approvals, approval UI, or action budgets.
- Calendar watch work, Apple work, or additional Gmail/Drive/GitHub slices.
- Any ChatGPT MCP Mode A tool changes.
- Any production apply or rollout changes.

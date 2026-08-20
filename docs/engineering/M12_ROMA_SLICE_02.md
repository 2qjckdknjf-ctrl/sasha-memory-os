# M12 Slice 02 - ROMA scheduled project-health jobs

## In scope

- One additive backend schedule row per explicit `project_id` for `roma_project_health`.
- Schedule create/update/disable RPC + API path for operators or service subjects that already have workspace membership and project read.
- A due-tick path on the existing ROMA worker stack that enqueues the existing `roma_project_health` job through the Slice 01 enqueue RPC.
- Idempotent per-period enqueueing, bounded to one project and one summary per due tick.
- Fail-closed behavior when the project disappears or ROMA loses the required ACLs.

## Out of scope

- Scheduler UI.
- Notifications, approvals, approval UI, or action budgets.
- QA-findings write type changes.
- Calendar watch, Apple, or additional Gmail/Drive/GitHub slices.
- Any ChatGPT MCP Mode A tool changes.
- Any production apply or rollout changes.

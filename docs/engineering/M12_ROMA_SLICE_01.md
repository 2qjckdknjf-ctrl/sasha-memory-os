# M12 Slice 01 - ROMA audited project-health job

## In scope

- One additive processing job type: `roma_project_health`.
- Explicit enqueue for one `project_id`; no workspace-wide fallback.
- Execution under the ROMA service subject only.
- One project-scoped health summary write with provenance, reason, and audit trail.
- Idempotent enqueue/write behavior for the same bounded request.

## Out of scope

- Scheduler UI or recurring automation setup.
- Approval UI or approval checkpoint workflows.
- Action budgets or rate-budget policy surfaces.
- Notifications or delivery fan-out.
- Calendar watch work, Apple work, or new Gmail/Drive/GitHub slices.
- Any change to ChatGPT MCP Mode A tool count.

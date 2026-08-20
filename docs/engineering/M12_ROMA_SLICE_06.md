# M12 Slice 06 - ROMA action budgets

## In scope

- One additive per-project ROMA action budget with an explicit `project_id`.
- Owner/operator upsert + disable path for `max_actions` per `window_minutes`.
- Fail-closed enforcement for ROMA automation writes before memory lands:
  - `roma_project_health`
  - `roma_project_findings`
  - approved `approval_checkpoints` writes
- Durable rejection audit when the budget is missing or exhausted.
- Atomic enforcement inside the existing write RPC so successful budget consumption only commits when the write commits.

## Out of scope

- Approval UI, inbox UI, or any new delivery UI.
- Email, Slack, push, Calendar watch, Apple, or extra Gmail/Drive/GitHub slices.
- Provider billing, token accounting, or broader workspace/provider cost budgets.
- Any new ChatGPT MCP Mode A tool or profile change.
- Any production apply or rollout change.

## Closeout note

With Slice 06 landed, official M12 roadmap works 01-06 are closed in-repo:

1. ROMA project health jobs
2. schedules
3. QA findings
4. notifications
5. approval checkpoints
6. action budgets

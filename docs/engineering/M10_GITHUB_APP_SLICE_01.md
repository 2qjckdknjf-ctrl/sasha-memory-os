# M10 GitHub App Slice 01

M10 Slice 01 starts the **official GitHub App path** on top of the existing M8 manual webhook receiver.

## In scope

- GitHub App installation binding to an existing GitHub connector connection.
- `installation_id`, account/org, and selected repository state stored on the connection metadata contract.
- Selected-repository-only routing for GitHub App webhook deliveries.
- Fast webhook ACK + enqueue of the existing connector sync path.
- `X-Hub-Signature-256` verification before JSON parsing in non-local environments.
- `X-GitHub-Delivery` idempotency with a bounded recent-delivery window.
- Bounded missed-delivery reconcile via the GitHub App webhook deliveries API.
- Revoke / uninstall handling that stops future sync enqueue.

## Out of scope

- Google Drive watch / change tokens / Picker work (Slice 02).
- Gmail, Google Calendar, ROMA automation, or M11/M12 work.
- Full-code contents indexing for every repository by default.
- Apple device / PhotoKit / appex / TestFlight work.
- Replacing the existing manual M8 receiver path.

## How this differs from M8

M8 added only a **manual repository webhook receiver**:

- `POST /v1/webhooks/github?connection_id=...`
- one repository webhook per repo
- no GitHub App installation binding
- no selected-repo installation contract
- no bounded missed-delivery reconcile

M10 Slice 01 keeps that path working, but adds the **GitHub App-native path**:

- deliveries can resolve a bound connection through `installation_id` and stored app metadata
- repository sync is constrained to explicitly selected repositories
- duplicate delivery GUIDs are ignored across a bounded recent window
- missed app deliveries can be replayed through the same webhook processing logic

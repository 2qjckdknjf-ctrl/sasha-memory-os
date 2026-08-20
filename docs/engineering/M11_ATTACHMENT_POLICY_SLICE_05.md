# M11 Slice 05 — Gmail and Calendar attachment policy

## Scope

- Lock Gmail and Google Calendar to metadata/reference attachment handling by default.
- Preserve existing selected-label / selected-calendar sync flows in `connectors/gmail` and `connectors/google-calendar`.
- Allow metadata-only attachment references when the provider already returned them on the message/event payload.
- Keep Gmail indexed-body opt-in limited to message body text; attachment bytes are never fetched or indexed.
- Keep `personal` sensitivity and the Slice 04 default-deny behavior unchanged.

## Out of scope

- Gmail `users/me/messages/{id}/attachments/{id}` fetches or any other attachment byte download path.
- Google Calendar attachment media download or a new attachment ingestion path.
- Calendar watch / push notifications.
- ROMA automation work.
- Apple connector work.
- Additional Google Drive or GitHub slices.
- Any new ChatGPT MCP Mode A tool; the surface stays exactly 7 tools.

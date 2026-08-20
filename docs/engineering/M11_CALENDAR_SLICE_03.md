# M11 Calendar Slice 03

## Scope

- Upgrade the existing `connectors/google-calendar` path in place.
- Private / restricted Google Calendar events default to busy-interval capture plus restricted metadata.
- Private-event content opt-in is explicit per selected calendar via `metadata.collections.items[].metadata.google_calendar.private_event_content = true`.
- Public / default-visibility events keep the existing Slice 02 reference / metadata capture path.
- Selected-calendar scope, per-calendar `syncToken`, and `410 Gone` bounded recovery continue to use the existing cursor / tombstone flow.

## Out of scope

- Calendar watch / push notifications.
- Gmail follow-up work.
- Attachment download or attachment policy changes.
- ROMA automation.
- Apple connector work.
- Additional Google Drive or GitHub slices.
- New SQL or a separate Calendar ingestion path.

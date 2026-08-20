# M11 Calendar Slice 02

## Scope

- Upgrade the existing `connectors/google-calendar` stack; do not add a second Calendar path.
- Selected Google calendars only via explicit `collections.selection_mode = "selected"`.
- Default Calendar capture stays `reference` / metadata-first with `personal` sensitivity.
- Incremental sync uses Calendar `events.list` with persisted per-calendar `nextSyncToken`.
- Incremental requests reuse the same Calendar query parameter set that minted the sync token.
- `410 Gone` on a stale Calendar sync token triggers a bounded resync of the selected calendars only.
- Cancelled / deleted events and projection exits emit tombstones through the shared connector-sync worker path.
- Connector writes stay project-bound through calendar collection bindings; no implicit fallback project is introduced.

## Out of scope

- Gmail follow-up slices.
- Calendar watch / push notifications.
- Private-event redaction policy work.
- Attachment download / attachment policy work.
- ROMA automation (M12).
- Apple device / companion work.
- Additional Google Drive or GitHub connector slices.
- New SQL unless the existing cursor / tombstone path becomes insufficient.

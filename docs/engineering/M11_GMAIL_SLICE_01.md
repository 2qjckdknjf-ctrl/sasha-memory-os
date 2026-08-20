# M11 Gmail Slice 01

## Scope

- Upgrade the existing `connectors/gmail` stack; do not add a second Gmail path.
- Selected Gmail labels only via explicit `collections.selection_mode = "selected"`.
- Default Gmail capture stays `reference` / metadata-first.
- Incremental sync uses `history.list` with a persisted `startHistoryId`.
- Expired Gmail history cursors trigger a bounded resync of the selected labels only.
- Deleted messages and label removals emit tombstones through the shared connector-sync worker path.
- Connector writes stay project-bound through collection bindings; no implicit fallback project is introduced.

## Out of scope

- Google Calendar work (remaining M11 slices).
- ROMA automation (M12).
- Apple device / companion work.
- Additional Google Drive or GitHub connector slices.
- Full-mailbox crawling or implicit `INBOX` defaults.
- New SQL unless the existing connector cursor / tombstone path becomes insufficient.

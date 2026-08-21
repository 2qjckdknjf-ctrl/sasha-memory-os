# M16 Slice 03 - iCloud Drive / Files

Status: implementation slice on top of M16.1–M16.2.

## Goal

Selected-folder/file ingest for iCloud Drive / Files via companion bookmarks:
metadata-first indexing, change detection with version/checksum, content
extraction only when permitted, binary to governed object storage only when
policy allows (otherwise reference), delete/move → tombstone or rescope.
Never full-home / full-iCloud walk or server-side scrape.

Official pack version: `m16-s03-v1`

Roadmap sections: `16.3`, `icloud-drive-files`

## In scope

- Selected-scope membership helper
- `decideFilesIngest` (metadata-first / content / reference / tombstone)
- Version+checksum tracking helper
- CURRENT_STATE tip update
- Live UIDocumentPicker E2E blocker

## Out of scope

- Live security-scoped bookmark runtime on device
- Photos (M16.4)
- Changing ChatGPT Mode A tools

## Definition of Done

- Out-of-scope objects ignored/tombstoned; in-scope upsert metadata-first by default
- Delete emits tombstone; version/checksum tracked
- Live picker E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M16.5-notes-reminders-contacts`

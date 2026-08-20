# M10 Drive Slice 02

M10 Slice 02 upgrades the existing `connector-google-drive` from an M8-style
`files.list` stub/incremental heuristic to the **official selected-scope Drive
contract** from the baseline roadmap.

## In scope

- Google Drive selected files/folders only via explicit `collections.selection_mode = "selected"`.
- Narrow Drive auth (`drive.file` or equivalent narrow selected-file scope), not broad `drive.readonly`.
- Selected folder descendants are allowed; siblings outside the selected scope are ignored or tombstoned.
- `changes.getStartPageToken` + `changes.list` incremental sync with cursor state stored per connection scope.
- Drive watch treated as a **signal** only: ACK the notification, dedupe it, and enqueue the existing connector sync path.
- In non-`local`/`test` environments, Drive watch requires `MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN`
  and validates `X-Goog-Channel-Token` before enqueue.
- Permission loss / move-out / selected-scope disappearance translated into tombstones that remove prior memories from active retrieval.
- Expired/invalid change token recovery via **bounded selected-scope resync**, never a full-drive crawl.
- Default storage mode remains `reference`; `indexed` is only used for explicitly selected files.

## Out of scope

- Broad Google Drive indexing or implicit My Drive / Shared Drive enumeration.
- Gmail / Google Calendar work (M11).
- ROMA automation (M12).
- A second parallel Google Drive connector stack.
- Any new MCP Mode A tool beyond the existing 7-tool budget.
- Full Drive watch reconciliation pipeline beyond signal ACK + enqueue.

## Implementation notes

- The selected-scope roots continue to live on `connector_accounts.metadata.collections`.
- Incremental cursor state continues to live in `connector_cursors`; no parallel cursor table was introduced.
- Deleted / permission-lost Drive objects use a tombstone RPC keyed by connector provenance
  (`provider` + `account_id` + `external_id`) so retrieval stops serving stale content.
- `X-Goog-Channel-Token` may be either the raw watch secret (with `connection_id` passed separately)
  or a querystring-style token that includes both `watch_token` and `connection_id`.

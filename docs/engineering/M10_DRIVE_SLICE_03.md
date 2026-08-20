# M10 Drive Slice 03

M10 Slice 03 continues the official Google Drive connector work after Slice 02
and stays inside the roadmap scope from `§13.2` and `§20.13`.

## In scope

- Export + parse **selected Google-native Docs / Sheets / Slides** when the
  effective Drive `storage_mode` is `indexed`.
- Preserve `reference` as the default behavior: metadata + canonical link, no
  broad content copy for unindexed Drive objects.
- Allow an explicitly `indexed` selected folder to propagate indexed ingest to
  its selected-scope descendants.
- Capture a source permission snapshot during Drive ingest.
- Fail closed on source permission shrink/loss by reusing the existing
  connector tombstone RPC path so the object leaves active retrieval.

## Out of scope

- Gmail / Google Calendar work (M11).
- ROMA automation (M12).
- Broad My Drive / Shared Drive crawling or `drive.readonly`.
- A second Drive connector stack, extra ChatGPT Mode A tools, or extra GitHub
  App work.
- New SQL unless the existing tombstone RPC becomes insufficient.

## Implementation notes

- Google-native export stays inside the existing `connectors/google-drive`
  connector and current worker/API sync path.
- Indexed exports use provider-supported document conversions:
  - Docs -> plain text
  - Sheets -> XLSX workbook parsed into plain text rows
  - Slides -> plain text
- Permission propagation is handled in connector sync state and normalized
  metadata so later ACL shrink can tombstone the prior indexed object without
  introducing a parallel deletion path.

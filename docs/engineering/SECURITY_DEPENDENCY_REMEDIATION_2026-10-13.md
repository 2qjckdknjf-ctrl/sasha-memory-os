# Dependency security remediation — 2026-10-13

## Outcome

`pnpm audit` reports zero known vulnerabilities across the workspace. CI now
fails for any advisory at `moderate` severity or above.

## Changes

- Upgraded Vitest to `4.1.11`, removing the vulnerable `tinypool` and mocker paths.
- Upgraded Hono to `4.13.13`.
- Pinned `@xmldom/xmldom` to `0.8.15` and `source-map-js` to `1.2.2`.
- Replaced vulnerable `xlsx@0.18.5` with `exceljs@4.4.0` for Google Sheets exports.
- Replaced Mammoth's DOCX extraction path with bounded JSZip + SAX parsing.
- Pinned the ExcelJS UUID dependency to the patched `11.1.1` release.

## Verification

- `pnpm audit`: 0 vulnerabilities.
- Google Drive connector: 8 tests PASS and typecheck PASS.
- Ingestion package: 23 tests PASS and typecheck PASS.
- DOCX parser rejects `DOCTYPE` declarations and bounds expanded document XML.

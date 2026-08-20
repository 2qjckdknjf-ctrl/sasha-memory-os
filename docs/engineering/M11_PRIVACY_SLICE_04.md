# M11 Slice 04 — personal default-deny for agents

## Scope

- Close the M11 privacy-beta gate for agent reads of connector-derived memories.
- Enforce the existing ACL `sensitivityMax: internal` ceiling on local/offline read paths so Cursor, ROMA, and ChatGPT do not read `personal` Gmail/Calendar memories by default.
- Keep owner access unchanged.
- Preserve the existing path where an explicit ACL grant can raise access above the default ceiling.

## In scope

- `memory.search`, `memory.get`, and project-context retrieval must filter `personal` (and higher) memories for non-owner agents unless ACL explicitly grants that sensitivity.
- Negative tests proving Cursor, ROMA, and ChatGPT do not retrieve personal Gmail/Calendar-style memories by default.
- Regression coverage so owner access still works.

## Out of scope

- Calendar watch / push notifications.
- Attachment download or attachment parsing.
- ROMA automation changes.
- Apple connector follow-ups.
- Additional Drive or GitHub slices.
- Any new ChatGPT MCP Mode A tool; the tool surface stays exactly 7.

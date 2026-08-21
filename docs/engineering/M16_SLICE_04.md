# M16 Slice 04 - Photos

Status: implementation slice on top of M16.1–M16.3.

## Goal

User-approved Photos library ingest: metadata / album / asset identifiers,
timestamps, and location only when sensitivity policy allows. Optional image
understanding requires explicit opt-in — never silent bulk semantic analysis of
private photos. Deletions and duplicates are idempotent. Limited library =
selected assets only.

Official pack version: `m16-s04-v1`

Roadmap sections: `16.4`, `photos`

## In scope

- `decidePhotosIngest` permission/selection/understanding gates
- Idempotency key helper for durable asset ids
- CURRENT_STATE tip update
- Live PhotoKit E2E blocker

## Out of scope

- Live PhotoKit device runtime
- Notes/Reminders/Contacts (M16.5)
- Changing ChatGPT Mode A tools

## Definition of Done

- Limited permission rejects non-selected assets
- Default metadata-only; understanding only with opt-in
- Delete → tombstone; durable asset idempotency keys
- Live PhotoKit E2E blocked; fixtures PASS
- Mode A remains 7 tools

## Next

`M16.5-notes-reminders-contacts`

# M16 Slice 05 - Notes / Reminders / Contacts

Status: implementation slice on top of M16.1–M16.4.

## Goal

Selected-source ingest for Notes (share/manual only), Reminders (EventKit
selected lists), and Contacts (metadata-minimal opt-in fields) with typed
memory mappings. No CloudKit dump, no server-side scrape, no full address book
sync.

Official pack version: `m16-s05-v1`

Roadmap sections: `16.5`, `notes-reminders-contacts`

## In scope

- `decideNotesIngest` / `decideRemindersIngest` / `decideContactsIngest`
- Typed field allowlists + `mapPersonalSourceFields`
- Idempotency keys per source ref
- CURRENT_STATE tip update
- Live EventKit/Contacts device E2E blocker

## Out of scope

- Live EventKit / Contacts runtime on device
- Full entity graph (M17)
- Changing ChatGPT Mode A tools

## Definition of Done

- Notes reject non share/manual paths
- Reminders/contacts require explicit selection
- Contacts stay metadata-minimal with field allowlist
- Live device E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M17-entity-graph` (or next canonical plan slice after M16 bridge completion)

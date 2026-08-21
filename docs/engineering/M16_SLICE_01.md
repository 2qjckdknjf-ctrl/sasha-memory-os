# M16 Slice 01 - Apple capability feasibility matrix

Status: first M16 slice after M15 live E2E gate routed here with documented blockers.

## Goal

Document supported public access paths, platform restrictions, scopes, and what
cannot be automated for iCloud Drive/Files, Photos, Notes, Reminders, Contacts,
and device metadata. Choose native macOS/iOS companion bridging wherever
server-side iCloud APIs are unavailable. Never rely on private iCloud scraping.

Official pack version: `m16-s01-v1`

Roadmap sections: `16.1`, `apple-capability-feasibility-matrix`

## Decision

**Companion-required** for personal Apple sources. Memory OS servers must not
crawl iCloud. Existing `apps/apple-companion` + `appleCompanion` contracts are
the bridge foundation; M16.2 hardens security (Keychain, device identity,
encrypted transport).

## In scope

- Six-row feasibility matrix (machine-readable + docs)
- Explicit cannot-automate / private-API denials
- CURRENT_STATE tip → M16.1; next M16.2
- Live device E2E recorded as blocked (matrix-only slice)

## Out of scope

- Live PhotoKit / UIDocumentPicker / EventKit device implementation
- TestFlight / signing
- M16.2 security foundation implementation details beyond naming the next slice

## Definition of Done

- Matrix covers Files, Photos, Notes, Reminders, Contacts, device metadata
- Every row chooses companion bridge where public cloud API is missing
- Pack asserts no server-side scrape stance
- Mode A remains 7 tools

## Next

`M16.3-icloud-drive-files`

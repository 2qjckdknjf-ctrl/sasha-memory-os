# Apple companion

Slice 03 defines the Files bookmark contract for the native Apple path in M9 (§14.3, §14.7), while keeping the Slice 02 limited-photos contract intact:

- a Swift Package that Xcode can open today,
- a shared Swift domain mirror for the Apple companion ingest, limited-selection, Files bookmark, and encrypted-queue JSON contract,
- a SwiftUI scaffold for auth/session status, permission inspection, queue inspection, and share-item intake stubs,
- no TestFlight, no signing setup, no live PhotoKit or UIDocumentPicker enumeration on device, no iCloud Drive crawl beyond selected bookmarks, and no runtime Share Extension target yet.

## What Slice 03 does

- Mirrors the TypeScript source-of-truth contract from `packages/schemas/src/appleCompanion.ts`.
- Keeps the PhotoKit limited-library contract from Slice 02:
  - permission (`not_determined`, `limited`, `full`, `denied`)
  - durable selected-asset identifiers
  - an opaque change token/checkpoint persisted with the device queue contract
- Defines the limited-library expectations for CI:
  - only explicitly selected assets are eligible for ingest when permission is limited
  - removing an asset from the limited selection produces a tombstone contract event
  - revoke stops further photo-library ingest and excludes prior Apple photo objects through the existing deleted flag path
- Adds the Files/iCloud Drive bookmark contract:
  - durable selected file/folder bookmarks with provider item identifiers and opaque security-scoped bookmark blobs
  - explicit scope rules: exact selected file or child of a selected directory only
  - stale bookmark resolution that produces a visible `reselect_required` contract result instead of a silent success
  - security-scoped access modeled as a lease so `startAccessing...` and `stopAccessing...` stay paired
  - selected-folder monitor checkpoints/change tokens for incremental child-only deltas
  - bookmark removal tombstones prior ingested file objects through the existing deleted flag path
- Models the local durable encrypted queue item lifecycle:
  - `pending`
  - `uploading`
  - `failed`
  - `done`
- Adds explicit queue failure semantics for stale bookmarks (`reselect_required`) without auto-retrying.
- Defines Apple-specific interfaces for:
  - PhotoKit permission, selection, and change-token inspection
  - Files bookmark resolution, security-scoped lease handling, and stale-bookmark reselect
  - share-item intake handoff into the local queue
- Provides a SwiftUI shell with:
  - auth session placeholder
  - connection and permission inspector placeholder
  - queue list
  - share-text intake stub

## What Slice 03 does not do

- No TestFlight or signing workflow
- No full-library PhotoKit scan
- No live PhotoKit device implementation yet
- No live UIDocumentPicker / PhotoKit runtime integration yet
- No implicit home-directory or full iCloud Drive walk
- No live Share Extension target
- No Share Extension target in this slice
- No server-side iCloud or Photos scraping
- No M10/M11/M12 scope

## Open in Xcode

1. Open `apps/apple-companion/Package.swift` in Xcode.
2. Inspect the shared domain in `Sources/AppleCompanionDomain`.
3. Inspect the SwiftUI scaffold in `Sources/AppleCompanionAppScaffold`.

This package is intentionally not compiled in Linux CI. The monorepo verification for this slice remains TypeScript-centric: the TypeScript contract is the source of truth, and Swift mirrors it for later live picker/runtime work.

## Key files

- `Package.swift` — Xcode-openable Swift package entry
- `Sources/AppleCompanionDomain/AppleCompanionContracts.swift` — Swift mirror of the JSON contract
- `Sources/AppleCompanionDomain/AppleCompanionQueueReducer.swift` — queue state transitions
- `Sources/AppleCompanionDomain/AppleCompanionIntegrationInterfaces.swift` — native contract protocols for limited-library state plus Files bookmark/lease resolution
- `Sources/AppleCompanionAppScaffold/MemoryOSAppleCompanionRootView.swift` — SwiftUI scaffold

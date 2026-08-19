# Apple companion

Slice 04 defines the Share Extension contract for the native Apple path in M9 (§14.6, §14.7), while keeping the Slice 02 limited-photos and Slice 03 Files bookmark contracts intact:

- a Swift Package that Xcode can open today,
- a shared Swift domain mirror for the Apple companion ingest, share-intake, limited-selection, Files bookmark, and encrypted-queue JSON contract,
- a SwiftUI scaffold for auth/session status, permission inspection, queue inspection, and share-item intake stubs,
- no TestFlight, no signing setup, no live PhotoKit or UIDocumentPicker enumeration on device, no iCloud Drive crawl beyond selected bookmarks, and no runtime Share Extension target yet.

## What Slice 04 does

- Mirrors the TypeScript source-of-truth contract from `packages/schemas/src/appleCompanion.ts`.
- Adds the Share Extension intake contract from §14.6:
  - incoming share kinds for `photo`, `video`, `file`, `url`, and selected `text`
  - required `project_id`, `sensitivity`, and `storage_mode`, plus optional `memory_type`
  - queue-only mapping into `AppleCompanionIngestRequest` with `needs_companion_processing`
  - no OCR / LLM / normalize work inside the constrained extension runtime
- Extends the durable queue contract with visible status labels for:
  - `pending`
  - `uploading`
  - `failed`
  - `done`
  - `reselect_required`
- Models offline share handoff and later drain/resume through the existing `/v1/ingestion/apple-items` path.
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
- Adds a `ShareExtensionIntake` stub that only enqueues contract payloads; the signed appex target is intentionally deferred.
- Provides a SwiftUI shell with:
  - auth session placeholder
  - connection and permission inspector placeholder
  - queue list
  - share-text contract stub

## What Slice 04 does not do

- No TestFlight or signing workflow
- No full-library PhotoKit scan
- No live PhotoKit device implementation yet
- No live UIDocumentPicker / PhotoKit runtime integration yet
- No implicit home-directory or full iCloud Drive walk
- No live Share Extension target
- No signed Share Extension target in this slice
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
- `Sources/AppleCompanionDomain/ShareExtensionIntake.swift` — queue-only Share Extension mapper + stub
- `Sources/AppleCompanionDomain/AppleCompanionIntegrationInterfaces.swift` — native contract protocols for limited-library state plus Files bookmark/lease resolution
- `Sources/AppleCompanionAppScaffold/MemoryOSAppleCompanionRootView.swift` — SwiftUI scaffold

# Apple companion

Slice 02 defines the limited-library contract for the native Apple path in M9 (§14.4, §14.7):

- a Swift Package that Xcode can open today,
- a shared Swift domain mirror for the Apple companion ingest, limited-selection, and encrypted-queue JSON contract,
- a SwiftUI scaffold for auth/session status, permission inspection, queue inspection, and share-item intake stubs,
- no TestFlight, no signing setup, no live PhotoKit enumeration, no iCloud Drive crawl, and no runtime Share Extension target yet.

## What Slice 02 does

- Mirrors the TypeScript source-of-truth contract from `packages/schemas/src/appleCompanion.ts`.
- Models PhotoKit limited-library state with:
  - permission (`not_determined`, `limited`, `full`, `denied`)
  - durable selected-asset identifiers
  - an opaque change token/checkpoint persisted with the device queue contract
- Defines the limited-library expectations for CI:
  - only explicitly selected assets are eligible for ingest when permission is limited
  - removing an asset from the limited selection produces a tombstone contract event
  - revoke stops further photo-library ingest and excludes prior Apple photo objects through the existing deleted flag path
- Models the local durable encrypted queue item lifecycle:
  - `pending`
  - `uploading`
  - `failed`
  - `done`
- Defines placeholder Apple-specific interfaces for:
  - PhotoKit permission, selection, and change-token inspection
  - document picker / security-scoped bookmark management
  - share-item intake handoff into the local queue
- Provides a SwiftUI shell with:
  - auth session placeholder
  - connection and permission inspector placeholder
  - queue list
  - share-text intake stub

## What Slice 02 does not do

- No TestFlight or signing workflow
- No full-library PhotoKit scan
- No live PhotoKit device implementation yet (that starts in Slice 03+)
- No Files bookmark persistence/runtime resolution yet
- No live Share Extension target
- No server-side iCloud or Photos scraping

## Open in Xcode

1. Open `apps/apple-companion/Package.swift` in Xcode.
2. Inspect the shared domain in `Sources/AppleCompanionDomain`.
3. Inspect the SwiftUI scaffold in `Sources/AppleCompanionAppScaffold`.

This package is intentionally not compiled in Linux CI. The monorepo verification for this slice remains TypeScript-centric.

## Key files

- `Package.swift` — Xcode-openable Swift package entry
- `Sources/AppleCompanionDomain/AppleCompanionContracts.swift` — Swift mirror of the JSON contract
- `Sources/AppleCompanionDomain/AppleCompanionQueueReducer.swift` — queue state transitions
- `Sources/AppleCompanionDomain/AppleCompanionIntegrationInterfaces.swift` — placeholder native integration protocols for limited-library state/change tracking
- `Sources/AppleCompanionAppScaffold/MemoryOSAppleCompanionRootView.swift` — SwiftUI scaffold

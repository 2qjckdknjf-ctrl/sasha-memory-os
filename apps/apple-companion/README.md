# Apple companion

Slice 01 boots the foundation for the native Apple path in M9 (§20.12, §14):

- a Swift Package that Xcode can open today,
- a shared Swift domain mirror for the Apple companion ingest and encrypted-queue JSON contract,
- a SwiftUI scaffold for auth/session status, permission inspection, queue inspection, and share-item intake stubs,
- no TestFlight, no signing setup, no live PhotoKit enumeration, no iCloud Drive crawl, and no runtime Share Extension target yet.

## What Slice 01 does

- Mirrors the TypeScript source-of-truth contract from `packages/schemas/src/appleCompanion.ts`.
- Models the local durable encrypted queue item lifecycle:
  - `pending`
  - `uploading`
  - `failed`
  - `done`
- Defines placeholder Apple-specific interfaces for:
  - PhotoKit permission inspection
  - document picker / security-scoped bookmark management
  - share-item intake handoff into the local queue
- Provides a SwiftUI shell with:
  - auth session placeholder
  - connection and permission inspector placeholder
  - queue list
  - share-text intake stub

## What Slice 01 does not do

- No TestFlight or signing workflow
- No full-library PhotoKit scan
- No limited-library import runtime yet
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
- `Sources/AppleCompanionDomain/AppleCompanionIntegrationInterfaces.swift` — placeholder native integration protocols
- `Sources/AppleCompanionAppScaffold/MemoryOSAppleCompanionRootView.swift` — SwiftUI scaffold

# M16 Slice 02 - Apple companion security foundation

Status: implementation slice on top of M16.1 feasibility matrix.

## Goal

Define the security foundation for the native Apple companion: Keychain (or
Secure Enclave–wrapped Keychain) secret refs, opaque device identity binding,
explicit least-privilege source selection, encrypted transport envelopes to the
Memory API, and offline queue replay that reuses idempotency keys.

Official pack version: `m16-s02-v1`

Roadmap sections: `16.2`, `apple-companion-security-foundation`

## In scope

- Device identity + Keychain secret ref contracts
- Encrypted transport envelope builder (fixture stub cipher)
- Offline replay plan with idempotency reuse
- Least-privilege source selection helper
- Queue JSON raw-secret validation
- CURRENT_STATE tip update
- Explicit TestFlight/signing / live Keychain E2E blocker

## Out of scope

- Live signed companion / TestFlight
- Real Secure Enclave crypto implementation on device
- iCloud Drive / Photos runtime (M16.3+)

## Definition of Done

- Raw tokens cannot be stored as binding refs or queue JSON secrets
- Replay attempts reuse the same idempotency key
- Denied sources stay out of least-privilege allow set
- Live signed E2E blocked; contract fixtures PASS
- Mode A remains 7 tools

## Next

`M16.4-photos`

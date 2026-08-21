# M15 Slice 04 - canonicalization / dedupe / supersession

Status: implementation slice on top of M15.1–M15.3 and existing consolidation supersede paths.

## Goal

Make source-level dedupe and authority-aware supersession explicit: identical
source identities collapse; same-fingerprint facts follow a fact-class authority
matrix; provenance and `superseded_by` chains are preserved.

Official pack version: `m15-s04-v1`

Roadmap sections: `15.4`, `canonicalization-dedupe-supersession`

## In scope

- Authority matrix by fact class (repo/calendar/email/drive/decision/summary/…)
- `buildSourceDedupeKey` + `decideCanonicalDedupe`
- Duplicate-rate acceptance helper (target &lt;1%)
- Pack docs/tests + CURRENT_STATE tip update
- Reuse existing consolidation/`supersedeMemory` workers (no rewrite)

## Out of scope

- Full semantic embedding duplicate detector rewrite
- Cross-project merges
- Live production backfill of historical duplicates
- Freshness engine (M15.5)
- ChatGPT Mode A tool changes

## Definition of Done

- Source-identity collisions resolve to one keeper
- User-approved decisions outrank inferred summaries
- Cross-project candidates stay separate
- Measured duplicate rate helper enforces &lt;1% acceptance target in tests
- Mode A remains 7 tools

## Next

`M15.5-freshness-reconciliation`

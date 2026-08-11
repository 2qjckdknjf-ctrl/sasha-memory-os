# ADR-003: Storage modes for external objects

- **Status:** Accepted
- **Date:** 2026-08-11
- **Baseline:** §2.3, §12.7

## Context

Connectors can index mail, drive files, photos, and repos. Copying everything by default is costly, legally risky, and contradicts “source service remains primary truth.”

## Decision

Every connected object uses an explicit storage mode:

| Mode | Stored locally |
|---|---|
| `reference` | IDs, metadata, permission snapshot, checksum/version, link |
| `indexed` | Reference plus extracted text, chunks, summary, embeddings |
| `archived` | Indexed plus independent versioned copy of the original |

Wider modes never inherit automatically when scope expands. User chooses mode per account/collection/object.

## Consequences

- Default for heavy sources is `reference` or narrowly selected `indexed`.
- Live fetch is used when freshness requires authoritative provider state.
- Disconnect/revoke must apply retention to derivatives for each mode.

## Security and roadmap impact

- Reduces secret sprawl and backup surface versus blanket archival.
- Google/Apple compliance tracks can start with narrow scopes (M9–M11).

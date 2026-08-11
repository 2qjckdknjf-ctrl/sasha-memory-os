# ADR-001: Canonical shared memory

- **Status:** Accepted
- **Date:** 2026-08-11
- **Baseline:** §1, §4.1

## Context

ChatGPT, Cursor, ROMA and future agents otherwise keep incompatible session-local context. A plain vector store does not define facts, history, conflicts, ACL, or provenance.

## Decision

Sasha Memory OS is the single external canonical long-term memory. All clients read and write through one Memory Core with centralized ACL/RLS, temporal model, and provenance. Clients must not maintain divergent authoritative copies of project truth.

## Consequences

- MCP Gateway and HTTP API are the supported integration surfaces.
- Cross-client handoff becomes a first-class product flow.
- Local caches are disposable projections, never source of truth.
- Schema and policy changes affect every client and require versioned contracts.

## Security and roadmap impact

- Central policy reduces cross-client leakage risk when RLS is correct; a bug is also higher blast radius — negative RLS tests are mandatory from M2.
- Unblocks M6 (shared AI memory) without per-client memory rewrites.

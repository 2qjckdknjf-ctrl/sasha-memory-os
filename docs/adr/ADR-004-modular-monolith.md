# ADR-004: Modular monolith for V1

- **Status:** Accepted
- **Date:** 2026-08-11
- **Baseline:** §4.2, §4.4

## Context

Early microservice sprawl slows a 1–2 person delivery of Memory Core, MCP, and connectors. Module boundaries are still required for later extraction.

## Decision

V1 is a **modular monolith** with separate **worker processes** where async work needs isolation:

- API / Memory Gateway
- MCP Gateway
- ingestion, connector-sync, consolidation workers
- Web/PWA and Apple companion as clients
- PostgreSQL/Supabase + Object Storage

Physical service splits happen only after proven load or isolation requirements. Repository layout follows baseline §4.4 (`apps/`, `workers/`, `packages/`, `connectors/`, `supabase/`, `tests/`).

## Consequences

- Shared packages (`domain`, `schemas`, `authz`, …) enforce boundaries in-process.
- Deploy complexity stays low for M1–M6; workers scale independently when queues demand it.
- Teams must resist hidden cross-module imports that bypass package APIs.

## Security and roadmap impact

- `service_role` and connector secrets stay server-side in trusted runtimes only.
- Aligns with WP-01 skeleton and M1 platform foundation exit criteria.

# ADR-002: Event store and projections

- **Status:** Accepted
- **Date:** 2026-08-11
- **Baseline:** §4.1, §5, §8–9

## Context

Memory must remain auditable and correctable. Overwriting “current facts” destroys history and blocks supersession, conflict resolution, and provenance.

## Decision

- **Append first:** raw source events and audit records are append-only for application roles.
- **Derived state:** current project state and active semantic memory are versioned projections of events and typed memory records.
- Corrections, supersessions, and retractions create new records/links; they do not erase prior history required for audit.

## Consequences

- Idempotent ingestion and optimistic concurrency on mutable projections are required.
- Retrieval must distinguish current truth vs history by default.
- Storage and query cost grow with event volume; partitioning and retention policies come later with measurement.

## Security and roadmap impact

- Provenance and temporal filters become release gates (RG1+).
- WP-02/WP-03 depend on this model for schema, outbox, and job lifecycle.

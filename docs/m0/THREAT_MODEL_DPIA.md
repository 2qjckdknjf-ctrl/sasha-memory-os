# Threat model + DPIA

Status: **V1 GA technical review refreshed 2026-10-15**. This is an engineering
DPIA record, not external legal advice or a formal regulator filing.

## Processing summary

Sasha Memory OS stores long-term personal and work memory for one owner and
explicitly authorized agents. The primary control plane is Supabase Postgres in
`eu-central-1`, server-only RPCs, the seven-tool Edge MCP, owner Control Center,
vault-backed connectors, and scheduled workers. Every memory write requires an
explicit project; there is no AISTROYKA/default-project fallback.

Data subjects include the owner and incidental authors in selected repositories,
files, mail and calendar events. The stated purpose is multi-agent continuity
and owner-controlled retrieval. Collection is limited to explicit capture and
selected connector scopes. Proposed lawful basis remains owner consent and
legitimate interest for personal productivity; connected third-party content
must be minimized.

The authoritative data map and enforced retention windows are in
[DATA_CLASSES_AND_RETENTION.md](./DATA_CLASSES_AND_RETENTION.md).

## Assets and trust boundaries

1. Canonical memories, source payloads, evidence, embeddings and graph data.
2. OAuth tokens and connector cursors held behind Vault/KMS and server RPCs.
3. API secret, Supabase service role and GitHub deployment credentials.
4. Audit, outbox and job metadata, which can reveal activity even without bodies.
5. Actor/session bindings for owner, ChatGPT, Cursor and ROMA.
6. Export bundles and privacy-request free text while processed in memory.

## Threats and landed controls

| ID | Threat | Current control |
|---|---|---|
| T1 | API/service credential theft | Server-only secrets, GitHub secret scanning/push protection, rotation runbooks, privileged RPC denial for browser roles |
| T2 | Token leakage in tables/logs | Vault refs only, KMS/local encrypted vault, metadata-only telemetry, connector revocation deletes secret/cursor material |
| T3 | Cross-subject/project disclosure | RLS, ACL, explicit project, sensitivity checks, 200-case retrieval gate with zero leakage |
| T4 | SSRF or credentialed URL capture | DNS/private-address and credentialed-URL rejection |
| T5 | Agent over-share or unsafe write | Seven bounded tools, per-actor ACL, candidate/review policy, no retrieval-side writes |
| T6 | Retry, stale job, or outbox duplication | Idempotent capture, advisory locking, bounded retry/dead-letter/replay and restore drills |
| T7 | AI-provider transfer | External embedding/transcription is optional, bounded and documented; local fallback exists |
| T8 | Wrong Supabase/project routing | Dedicated project ref, immutable project IDs, fail-closed routing and no default fallback |
| T9 | Incomplete erasure through derived data | M20.4 deletes evidence/revisions/chunks, clears vectors, removes graph projections and sanitizes source/artifact/audit snapshots |
| T10 | Sensitive privacy details in ops UI/logs | Strict operational allowlist; Privacy history does not render reasons/correction text; audit stores counts/IDs only |

## Rights implementation

| Right | Live contract |
|---|---|
| Access / portability | Owner-only fully paginated `GET /v1/export/privacy`, pinned to a stable `snapshotAt` cutoff and including provenance and connector-derived records |
| Correction | Idempotent privacy request plus owner execution; prior memory becomes superseded |
| Retraction | Owner execution marks the target retracted with metadata-only audit |
| Erasure | Target memory and derived data tombstoned; source-account request also resolves legacy payload identity, revokes the workspace-wide connector, vault, cursor, source-linked jobs and outbox, and erases its derived records across projects |
| Retention | Owner dry-run/apply route implementing the published 30/90/180/365-day windows |

## Residual risks and decisions

- OpenAI embedding/transcription can process content outside the primary EU
  region when explicitly enabled. Strict EU-only deployments must keep those
  providers disabled or complete a separate transfer assessment.
- Supabase reports the `vector` extension in `public`; it is tracked as advisor
  debt. Privileged RPCs remain client-denied and vectors inherit memory ACL.
- Real GitHub/Google connector E2E still requires provider credentials and user
  consent. Fixture/restore evidence is not described as live provider consent.
- Apple Photos/Files/Notes/Reminders/Contacts require the signed companion and
  real-device permissions; no server-side iCloud scraping is attempted.
- Daily database backups do not include future Supabase Storage objects. The
  first archived object remains blocked until an off-site versioned copy and
  checksum manifest meet the 24-hour object RPO.

The owner has accepted the original architecture and data classes. Any material
change in purpose, data volume, subject population, provider geography or
automated decision-making requires a new review.

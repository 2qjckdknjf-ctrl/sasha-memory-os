# M20.2 — reliability and disaster recovery release gate

Status: implementation and production inventory captured; final evidence is the
green trusted-`main` run of the mandatory ephemeral restore drill.

Official pack: `m20-s02-v1`

## Accepted recovery objectives

- Database RPO: `<= 24h` while PITR is not enabled. If PITR is enabled later,
  the accepted target becomes `<= 15m`.
- Archived-object RPO: `<= 24h` before the first archived Storage object is
  admitted.
- Private-beta RTO: `<= 8h`.
- Database and Storage remain independent recovery contours. A database backup
  never claims to restore a deleted Storage object.

## Production inventory — 2026-10-15

- Supabase dashboard shows scheduled physical database backups every day. The
  newest visible backup is `15 Oct 2026 06:59:40 (+0000)`; earlier visible
  backups cover 14–08 October.
- The dashboard states that Storage objects are not included in database
  backups.
- PITR is not enabled; the dashboard offers it as an add-on. The accepted live
  database RPO is therefore the documented daily `<= 24h`, not `15m`.
- Read-only production inventory: 45 public tables, 90 recorded migration
  entries, 0 buckets / 0 objects in Supabase Storage.
- Because the current Storage contour is empty, no object payload is claimed as
  backed up. The first archived object is blocked on a versioned off-site copy,
  checksum manifest, and the `<= 24h` object RPO.
- Worker inventory: 738 succeeded, 4 failed, and 142 dead-letter historical
  jobs; all failed/dead-letter rows are `connector_sync`. There are no queued or
  running jobs. Five non-terminal outbox events remain deliberately unacknowledged
  until a downstream consumer policy exists.
- Connector inventory remains 5 `reauth_required` and 1 `revoked`. No live
  provider recovery is claimed without real OAuth credentials and consent.

## Mandatory production-like drill

`scripts/m20-current-schema-restore-drill.sh` runs inside the disposable
Supabase CI environment after all repository migrations and security cases:

1. create a private temporary logical dump of the current `public`, `app`, and
   `vault` schemas; the extension-owned `vault.secrets` rows are deliberately
   excluded because secret material is recovered by Supabase physical backup,
   not exported by an application-level logical drill;
2. restore it into a fresh isolated database on the runner;
   Supabase-owned extension definitions and platform default ACLs are recreated
   by destination bootstrap, while Memory OS object grants remain in the dump;
3. compare metadata-only row/ID checksums, table/RLS counts, and RPC counts;
4. rerun the exhaustive M20.1 RLS/ACL matrix on the restored copy;
5. run the M20.2 worker and connector recovery drill on the restored copy;
6. create/read/delete a transient Vault secret inside a rolled-back transaction
   to prove the restored KMS boundary without copying or printing secrets;
7. remove the database and dump even on failure;
8. fail if measured restore time exceeds the accepted eight-hour RTO.

The drill does not log payload bodies or secrets. The dump never leaves the
ephemeral runner.

## Worker and connector drill

`tests/security/m20_reliability_dr_cases.sql` is transactional and rolls back.
It proves:

- stale queued work moves to `dead_letter` and its outbox event is reconciled;
- only a dead-letter connector job is replayed, with cursor reset and audit;
- retry increments the bounded attempt state;
- missing vault material changes the account to `reauth_required` and prevents
  future claims;
- restored token material plus explicit reauthentication makes the job
  claimable and completable again.

## Safety boundary and remaining blocker

A production restore is not authorized by this slice. It would overwrite live
state or create a billable restore target and therefore requires a separate
approved operation. The production backup inventory plus current-schema
isolated restore is the non-destructive GA evidence.

The provider-specific live recovery gate remains blocked by the absent GitHub
and Google OAuth credentials/user consent. This is not represented as PASS by
the transactional drill.

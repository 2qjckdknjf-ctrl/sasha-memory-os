# M20 security and repository governance

Status: implementation slice. The role-boundary migration must pass ephemeral
Supabase CI before production apply.

## GitHub controls enabled on 2026-10-13

- `main` is protected for administrators and contributors.
- Required checks are strict: `smoke`, `ephemeral-contract`, and
  `live-edge-smoke`.
- Force pushes and branch deletion are disabled; linear history and resolved
  review conversations are required.
- Secret scanning and push protection are enabled.
- Dependabot vulnerability alerts and automated security updates are enabled.
- CodeQL default setup is enabled for Actions, JavaScript/TypeScript, and Swift.
- Auto-merge and automatic head-branch deletion are enabled after gates pass.

The obsolete owner-snapshot PR #87 was closed after verifying that all four
intended Memory OS records already exist and newer P0/M15 milestones supersede
its stale blocker text.

## Supabase RPC boundary

Trusted server components select `MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY`; a
production runtime without it fails closed. The public/publishable key remains
available only for Supabase Auth and local test fallback.

Migration `20261013135122_m20_security_search_path_hardening.sql`:

- pins the remaining mutable sanitizer `search_path` to `pg_catalog`;
- removes `anon`, `authenticated`, and implicit `PUBLIC` execute privileges
  from every current `public.api_*` Memory RPC;
- makes the `app` implementation schema private to client roles;
- explicitly retains `service_role` execute privileges;
- revokes default public function execution for future migrations.

The guarded production migration workflow applies the M15 runtime recovery
migration before M20, verifies immutable checksums for both, and fails its
post-apply SQL unless the runtime reconciliation function and M20 role boundary
are present.

The API secret remains mandatory inside every privileged RPC. This provides a
second independent check if a service credential is accidentally used outside
its intended runtime.

## Verification gates

- Unit coverage proves service-role preference and production fail-closed
  behavior.
- Migration guards prevent restoration of client-role RPC grants.
- Ephemeral SQL asserts that no public SECURITY DEFINER Memory RPC is executable
  by `anon` or `authenticated`, while `service_role` remains executable.
- Full CI, dependency audit, CodeQL, secret-scanning alerts, and Supabase
  security/performance advisors are recorded after merge and production apply.

## Expected residual Supabase advisories

- `connector_vault_blobs` and `project_routing_corrections` intentionally have
  RLS with no client policies: direct client access is denied and only trusted
  server RPCs may operate on them.
- Moving the existing `vector` extension out of `public` is deferred until a
  separately tested extension relocation plan proves compatibility with all
  stored vector columns and functions.
- Auth leaked-password protection is a project setting, not DDL; it remains a
  release gate until verified enabled in the Supabase Auth configuration.

These exceptions do not authorize unresolved high/critical findings. Any
CodeQL, dependency, secret-scanning, RLS leakage, or token exposure finding is
a release blocker until resolved or explicitly proven false-positive with
evidence.

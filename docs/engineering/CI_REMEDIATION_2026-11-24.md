# CI dependency and ephemeral database remediation — 2026-11-24

## Evidence and scope

The failed [CI run 45381985289](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/45381985289)
belongs to roadmap PR #124 at `64fa0372185676ce70b136bced05d4b007797705`.
Its typecheck, lint, and test steps passed. Two independent gates failed:

- `ephemeral-contract`: `supabase/setup-cli@v1` could not resolve `latest`
  because the GitHub release lookup was rate limited.
- `smoke`: the dependency audit reported 18 advisories (2 high, 14 moderate,
  2 low). The gate remains `pnpm audit --audit-level=moderate`.

The previous [CI run 44716322804](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/44716322804)
also exposes a later ephemeral blocker: the runner's newer `pg_restore`
emits `SET transaction_timeout = 0`, which the configured PostgreSQL 15
server rejects. Retrying the latest run alone would not repair these defects.

This bounded fix starts from main `63b643a0b2fe5aed7638c9258bf531e369f4ebb9`.
It changes CI setup, the disposable restore path, and affected dependencies.
No production migration, deployment, protocol change, or release milestone is
part of this remediation.

## Dependency changes

| Dependency | Previous lockfile version | Selected version |
| --- | --- | --- |
| Zod (all three direct consumers) | 4.4.3 | 4.6.6 |
| Vite | 8.2.1 | 8.2.4 |
| Vitest and its internal packages | 4.1.11 | 4.1.12 |
| Hono | 4.13.13 | 4.13.16 |
| @hono/node-server | 2.1.0 | 2.1.6 |
| ESLint | 10.12.0 | 10.15.0 |
| typescript-eslint | 8.71.2 | 8.74.0 |

ESLint and typescript-eslint are updated within their existing major versions
because their upstream dependency ranges support patched minimatch 11.
The regenerated lockfile resolves minimatch 11.0.9 through those parents;
no incompatible global minimatch override is added. Existing overrides are
preserved. The lockfile is generated with the repository's pnpm 9.15.9.

## Reproducible Supabase setup and restore

The workflow pins Supabase CLI 2.121.0 and reports its version. An explicit
version bypasses the `releases/latest` request in
[setup-cli](https://github.com/supabase/setup-cli/blob/v1/src/utils.ts).
The [2.121.0 release](https://github.com/supabase/cli/releases/tag/v2.121.0)
exists and its service image versions match the successful October 21
[ephemeral run](https://github.com/2qjckdknjf-ctrl/sasha-memory-os/actions/runs/39540530453).
The old run did not log the CLI version directly; this historical match is
based on release dates and service image versions.

Ephemeral restore now opts into the existing Supabase database container's
`pg_dump` and `pg_restore`, so their major version matches the database.
The opt-in mode accepts only a local database URL. The custom dump is streamed
through private temporary files; the filtered table-of-contents file is created
inside the container by the same user running restore. Both temporary locations
are cleaned. Cleanup drops a target database only after this invocation has
successfully created it.

All existing inventory comparisons, object ACLs, RLS/security cases, Vault
checks, disaster recovery cases, and subsequent MCP acceptance remain enabled.
The ordinary restore-helper mode still uses host clients when no container is
specified.

## Verification

Local toolchain: Node 22.23.5 and pnpm 9.15.9.

- Frozen-lockfile installation: passed.
- Dependency audit: passed, zero advisories in every severity category.
- Workspace typecheck: passed.
- ESLint with zero warnings allowed: passed.
- Production web build: passed.
- Shell syntax and `git diff --check`: passed.
- Existing M20 reliability and performance gate pack: 3 tests passed.

The local full-suite attempts encountered `getaddrinfo EAI_AGAIN example.com`
in the existing public-URL resolution and MCP link-capture tests. No DNS/SSRF
test or production validation is disabled or weakened. Docker is unavailable in
the local editing environment. The remediation PR's hosted GitHub Actions run
is the acceptance evidence for the full unmodified suite, actual API container,
MCP authentication, and complete ephemeral PostgreSQL restore/security path.

`live-control-center-e2e` remains restricted to pushes on main by its existing
condition; a pull-request skip is not a successful live browser test.

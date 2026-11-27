# Privacy review regression repair — 2026-11-27

## Bounded slice

Reproduce and repair the four review findings mailed for PR #118 on November 26.
They were still present on main `b233b0f02fa0b5a8ce2218003a357e2b2a018d3c`, despite
the threads being marked resolved. This is a source repair, not a new milestone
or production acceptance claim.

The canonical Memory OS plan and current project context were read through the
live Memory OS connection with explicit project
`44444444-4444-4444-8444-444444444402`. The checkout and fetched main were clean
and identical before this slice began.

## Repairs and acceptance

1. Protect the complete `/v1/privacy/*` route family with the existing HTTP
   API-secret middleware. Production/staging reject missing or invalid secrets
   before parsing a request or calling a gateway. Authenticated owners retain
   access through the documented header or Bearer transport, and authenticated
   non-owners remain forbidden.
2. Validate export snapshot timestamps without normalizing them through
   JavaScript `Date`. Subsequent pages pass the exact PostgreSQL timestamp,
   including microseconds and timezone, back to the durable snapshot lookup.
3. Omit an absent retention `p_as_of` RPC argument so the existing PostgreSQL
   default supplies database time. Sending explicit `NULL` would be invalid;
   sending API-host time can incorrectly exceed database time. Explicit owner
   cutoffs and the dry-run/apply choice are preserved.
4. Distinguish a missing privacy request (404) from an unavailable/rerouted
   memory or connector target (409). Handle native Error and plain PostgREST
   error objects. Unrelated missing database objects remain server failures.
   A target conflict does not execute the request or silently change its state.

## Verification

- Baseline with the new regression checks: 10 of 13 API checks failed and 2 of
  3 new gateway checks failed, reproducing the defects before source changes.
- After repair: all 16 new checks passed; 137 API/auth/gateway checks passed in
  total, including adjacent existing coverage.
- All 24-workspace TypeScript checks and the repository lint gate passed.
- Frozen pnpm 9.15.9 installation and `git diff --check` passed.
- A full local test attempt stopped at an unrelated public-DNS lookup in
  `packages/ingestion/src/fetchLink.test.ts` (`EAI_AGAIN example.com`). Its
  assertions were preserved. Hosted CI is required before full-suite acceptance.
- Independent review checked middleware order, SQL defaults, timestamp precision,
  error-object handling and regression coverage; no blocking finding remained.

No schema/migration or remote data change is part of this slice. The separate
M20 live-retrieval CI failure on PR #124 is not claimed fixed by these changes.
Final exact-commit hosted validation is recorded in the pull-request description.

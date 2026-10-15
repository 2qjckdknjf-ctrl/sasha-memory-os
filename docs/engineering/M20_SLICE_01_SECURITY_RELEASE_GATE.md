# M20.1 — security release gate

Pack: `m20-s01-v1`

Status: **IMPLEMENTED / PRODUCTION AUTH HARDENING PENDING**

## Release rule

M20.1 passes only when the exhaustive database boundary, OAuth/vault/revoke boundary, repository scanners, dependency audit, refreshed threat model, and production leaked-password protection all pass with zero open P0/P1 security or privacy findings. A skipped live check is a blocker, never a pass.

## Exhaustive boundary

The ephemeral SQL gate enumerates the live schema rather than checking one representative RPC:

- every `public` Memory table has RLS enabled;
- every `public.api_*` RPC is `SECURITY DEFINER`, pins `search_path`, denies `PUBLIC`, `anon`, and `authenticated`, and remains executable by `service_role`;
- every `app` implementation function denies client-role execution and the schema denies client-role usage;
- `connector_vault_blobs` and `project_routing_corrections` remain deny-by-construction with no client read grant;
- the existing RLS corpus continues to exercise wrong-workspace, wrong-project, personal sensitivity, immutable event/audit, source-specific handoff, ROMA least privilege, routing correction, graph, and ChatGPT writeback cases.

Production read-only audit on 2026-10-15 found 45/45 public tables with RLS, 91/91 privileged RPCs server-only, 0 client-executable privileged RPCs, 0 mutable `search_path` security definers, and no client usage of `app`.

## OAuth, vault, and revoke

- OAuth authorization codes are fingerprinted and never returned after exchange.
- Access and refresh tokens are stored only through the configured vault backend; database/API/UI surfaces retain opaque vault references.
- Expired tokens use bounded refresh and write the replacement back to the same vault reference.
- Provider revoke or installation deletion changes the connection to `revoked`, deletes vault material, emits tombstones where applicable, and stops later sync/replay.
- Missing provider credentials fail closed as `reauth_required`; fixtures cannot claim live provider acceptance.

## Threat model

| Surface | Primary threat | Required control/evidence |
| --- | --- | --- |
| Database/RPC | cross-workspace, cross-project, or subject leakage | explicit workspace/project scope; deny-first ACL/RLS corpus; server-only RPC grants |
| OAuth/webhooks/vault | forged callback/webhook, replay, token disclosure | state/signature verification, idempotency, vault-only tokens, redacted logs, revoke stop-sync |
| Connectors/jobs | scope expansion, poison event, unsafe replay | selected collections, bounded retry/dead letter, dead-letter-only replay, quarantine |
| Apple companion | stolen device/key, silent private bulk ingest | device binding, Keychain, encrypted transport, explicit source selection; no claimed live pass without device evidence |
| Entity graph/retrieval | relationship inference leaks forbidden evidence | ACL-filtered evidence first, bounded traversal, explicit project, no cross-project fallback |
| Agent writeback | prompt injection or low-confidence promotion | source content treated as data, approved classes only, provenance, dedupe, conflict stop |
| Browser/Control Center | server credential exposed to JavaScript | same-origin browser calls and server-only proxy/header injection; production job only on trusted `main` |
| Backup/export/logs | copied sensitive payloads or secrets | encrypted/restricted artifacts, owner-only export, retention/deletion workflow, payload redaction |

## Current evidence

- GitHub open alerts: CodeQL `0`, secret scanning `0`, Dependabot `0`.
- Dependency audit at `moderate` and above: `0` vulnerabilities.
- Protected `main`: strict required checks, admin enforcement, linear history, no force push, no branch deletion, resolved review conversations.
- Supabase security advisors: two intentional RLS/no-policy informational findings; one `vector`-in-`public` warning; leaked-password protection remains the only actionable Auth warning until the trusted-main hardening workflow passes.
- The `vector` extension relocation is not attempted in this slice: moving a type-owning extension is a compatibility migration and requires a separate tested plan. Current RPC/RLS boundaries prevent client privilege escalation; this remains tracked P2 hardening debt rather than an unproved P0/P1 waiver.

## Live closeout

After this slice merges and main CI is green, dispatch `.github/workflows/m20-auth-hardening.yml` from `main`, verify `auth_leaked_password_protection=PASS`, rerun Supabase security advisors, and record a Memory OS read-after-write receipt. M20.1 stays open until that evidence is committed.

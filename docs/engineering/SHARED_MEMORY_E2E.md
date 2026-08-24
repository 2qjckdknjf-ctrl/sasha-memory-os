# Shared Memory E2E — ChatGPT ↔ Cursor

Pack version: `shared-memory-e2e-v1`

## Goal

Prove **bidirectional** shared memory between real ChatGPT MCP and real Cursor MCP sessions on explicit Sasha Memory OS project UUID `44444444-4444-4444-8444-444444444402`.

## Non-goals

- Service-role or API-secret impersonation of ChatGPT/Cursor actors
- Mock/fixture-only PASS claims
- Cross-project leakage (AISTROYKA `444...401`, HiAir `444...403`)

## Run

```bash
chmod +x scripts/acceptance-shared-memory-e2e.sh
MEMORY_OS_API_BASE_URL=http://localhost:8787 \
MEMORY_OS_API_SECRET=... \
MEMORY_OS_PROJECT_ID=44444444-4444-4444-8444-444444444402 \
./scripts/acceptance-shared-memory-e2e.sh
```

Live ChatGPT OAuth path: use Edge MCP `memory-mcp` with restricted profile; Cursor uses stdio MCP gateway with explicit `actor_subject_id`.

## Gates

| Gate | Status |
|------|--------|
| ChatGPT write → Cursor read | BLOCKED without live sessions |
| Cursor write → ChatGPT read | BLOCKED without new ChatGPT chat |
| Project isolation | P0 migration + ACL |
| Idempotency | Harness checks duplicate key |
| Actor binding | OAuth/client binding required in production |

Result artifact: [SHARED_MEMORY_E2E_RESULT.json](./SHARED_MEMORY_E2E_RESULT.json)

CI: `.github/workflows/shared-memory-e2e.yml` (fixture gate always; live job requires secrets + manual dispatch).

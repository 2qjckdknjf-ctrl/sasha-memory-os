# Shared Memory E2E — ChatGPT ↔ Cursor

Pack version: `shared-memory-e2e-v2`

## Goal

Prove **bidirectional** shared memory between real ChatGPT MCP and real Cursor MCP sessions on explicit Sasha Memory OS project UUID `44444444-4444-4444-8444-444444444402`.

## Non-goals

- Service-role or API-secret impersonation of ChatGPT/Cursor actors
- Mock/fixture-only PASS claims
- Cross-project leakage (AISTROYKA `444...401`, HiAir `444...403`)

## Run

1. Write a unique receipt through the real ChatGPT OAuth MCP app.
2. Read that marker through `scripts/cursor-mcp-session.mjs search`.
3. Write a second unique receipt through `scripts/cursor-mcp-session.mjs store-decision`.
4. Read that marker through the real ChatGPT OAuth MCP app.
5. Run the read-only receipt verifier:

```bash
MEMORY_OS_API_BASE_URL=https://<project>.supabase.co/functions/v1/memory-mcp \
MEMORY_OS_API_SECRET=... \
MEMORY_OS_PROJECT_ID=44444444-4444-4444-8444-444444444402 \
SHARED_MEMORY_CHATGPT_MEMORY_ID=<chatgpt-receipt-id> \
SHARED_MEMORY_CHATGPT_MARKER=<chatgpt-marker> \
SHARED_MEMORY_CURSOR_MEMORY_ID=<cursor-receipt-id> \
SHARED_MEMORY_CURSOR_MARKER=<cursor-marker> \
./scripts/acceptance-shared-memory-e2e.sh
```

The API secret is used only for read-only verification. The verifier checks the
stored project and `created_by_subject`; it never creates evidence or impersonates
ChatGPT/Cursor. Cursor uses the stdio MCP gateway with explicit Cursor identity.

## Gates

| Gate | Status |
|------|--------|
| ChatGPT write → Cursor read | PASS — receipt `abe4e574-9291-433b-9f39-00395eba6e6a` |
| Cursor write → ChatGPT read | PASS — receipt `8b67a712-1e31-41d2-9813-e2dfdf0e4d63` |
| Project isolation | PASS — both effective project IDs are `…4402` |
| Actor binding | PASS — ChatGPT `…3302`, Cursor `…3303` |
| Idempotency | PASS — replay returned the same receipt ID in both sessions |
| Mock exclusion | PASS — read-only verifier, `claimPassFromMocks=false` |

Result artifact: [SHARED_MEMORY_E2E_RESULT.json](./SHARED_MEMORY_E2E_RESULT.json)

CI: `.github/workflows/shared-memory-e2e.yml` runs the fixture gate on schedule.
Manual dispatch accepts the four live-session receipt fields, verifies them, and
uploads a machine-readable acceptance artifact.

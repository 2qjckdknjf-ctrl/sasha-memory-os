# Staging promote runbook (M1)

Private alpha promote path for Sasha Memory OS.

## Environments

| Env | Hosting | Secrets |
|---|---|---|
| local | `pnpm dev:api` / `dev:web` | repo `.env` (never commit) |
| staging ops | Supabase Edge `worker-ticks` + GH `Worker ticks` / `Worker node ticks` | GH Actions secrets |
| staging API (deferred) | Local / future Fly — scaffold `./scripts/fly-deploy-api.sh` only | Not required for current ops |
| prod | Same shape as staging; separate project/secrets when promoted | Dedicated only |

Live Supabase project: `sasha-memory-os` (`vpxblcxsvlylqyldiuwr`, `eu-central-1`) — see [SUPABASE.md](./SUPABASE.md).

## Promote checklist

1. `npx pnpm@9.15.9 typecheck && npx pnpm@9.15.9 test` green on `main`.  
2. Apply pending SQL migrations to target Supabase (CLI or remote SQL).  
3. Deploy Edge ticks: `./scripts/deploy-edge-ticks.sh` → health `version: 2`.  
4. Confirm GH secrets: `MEMORY_OS_API_BASE_URL`, `MEMORY_OS_API_SECRET`, Supabase URL/anon, vault, embed.  
5. Dispatch `Worker ticks` + `Worker node ticks`; both success.  
6. Optional Fly API: `flyctl auth login` → `./scripts/fly-deploy-api.sh` → point `MEMORY_OS_API_BASE_URL` at Fly if replacing Edge for HTTP.  
7. Smoke: `MEMORY_OS_API_BASE_URL=… ./scripts/smoke-api.sh` (full HTTP) and/or MCP `POST /mcp` initialize.  
8. Web: point at API base; OAuth callback URL matches registered redirect.

## Rollback

- Edge: redeploy previous function bundle / pin prior commit + `deploy-edge-ticks.sh`.  
- Fly: `flyctl releases rollback -a sasha-memory-os-api`.  
- DB: forward-fix migrations preferred; keep supersede/ACL migrations additive.

## Observability (alpha)

- Every API response includes `x-request-id` (echo client header or generate UUID).  
- Structured JSON access logs when `MEMORY_OS_ENV=staging|production` or `MEMORY_OS_HTTP_LOG=1`.  
- Hosted ops health: Edge `/worker-ticks/health` + GH Actions run history.

## MCP remote

- API: `POST {API}/mcp` (JSON-RPC; Bearer / `x-memory-os-api-secret` outside local).  
- Standalone: `pnpm --filter @memory-os/mcp-gateway start:http` → `:8790/mcp`.  
- See [MCP_CURSOR.md](./MCP_CURSOR.md) + [CHATGPT_MCP_PLAN.md](../m0/CHATGPT_MCP_PLAN.md).

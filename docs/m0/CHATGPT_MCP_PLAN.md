# ChatGPT custom MCP plan (RG0)

Status: **owner accepted 2026-08-12** — see [OWNER_ACCEPT_2026-08-12.md](./OWNER_ACCEPT_2026-08-12.md).

**Owner decision:** **B now** (MCP/HTTP read + Web/HTTP write). **A preferred** when ChatGPT workspace supports custom MCP write tools. HTTP MCP (`POST /mcp`) ready for A. Fallback B accepted.

## Goal

ChatGPT uses Memory OS as external long-term memory: search/context read; capture/decision write when the platform allows custom MCP tools.

## Capability matrix

| Mode | Read (search/context) | Write (capture/decision/status) | How |
|---|---|---|---|
| **A — Custom MCP tools** (preferred) | Yes | Yes if plan allows | Point ChatGPT MCP at Memory OS tool schemas (`apps/mcp-gateway`) |
| **B — MCP read + Web write** | MCP | Web control center / HTTP | When ChatGPT MCP is read-only |
| **C — Stdio MCP (Cursor/Claude)** | Yes | Yes | `pnpm --filter @memory-os/mcp-gateway start` — see [MCP_CURSOR.md](../engineering/MCP_CURSOR.md) |
| **D — HTTP API direct** | Yes | Yes | `x-subject-id` + actor headers; owner ops need API secret outside local |

## Demo subject

| Actor | Subject UUID | Notes |
|---|---|---|
| ChatGPT | `33333333-3333-4333-8333-333333333302` | Seed ACL: project write for decisions/capture |
| Owner | `33333333-3333-4333-8333-333333333301` | Full owner ops |
| Cursor | `33333333-3333-4333-8333-333333333303` | Project read + handoff |

## Mode A readiness (in-repo)

| Item | Status |
|---|---|
| Streamable HTTP `POST /mcp` (JSON-RPC) | Ready on API + standalone `:8790` |
| `GET /mcp` long-lived SSE | Not offered (405) — JSON responses are valid Streamable HTTP |
| Bearer / `x-memory-os-api-secret` | Required outside `local`/`test` |
| Pilot tool allowlist | `MEMORY_OS_MCP_PROFILE=chatgpt` |
| Defaults for actor/workspace | Filled when omitted on chatgpt profile; writes still require explicit `project_id` |
| `readOnlyHint` annotations + `instructions` | On `initialize` / `tools/list` |
| Smoke loop | `scripts/smoke-mcp-chatgpt.sh` |

### ChatGPT Developer mode registration

1. Host API on a public **HTTPS** URL — ChatGPT does not use local stdio.  
   - Local demo: run API, then `./scripts/tunnel-api.sh` (Cloudflare quick tunnel) → use printed `https://….trycloudflare.com/mcp`.  
   - Durable host: deferred (Fly scaffold kept).  
2. Set `MEMORY_OS_MCP_PROFILE=chatgpt` and `MEMORY_OS_API_SECRET` on the host.  
3. In ChatGPT: enable **Developer mode** → create app → MCP URL `{API}/mcp` → auth **Bearer token** = API secret.  
4. Confirm discovered tools are only the pilot set (no oauth/outbox/consolidation).  
5. Smoke: `MEMORY_OS_API_BASE_URL=https://… MEMORY_OS_API_SECRET=… ./scripts/smoke-mcp-chatgpt.sh`  
6. In chat: search with `pack_context` → `memory.store_decision` → Web timeline shows candidate.

## Integration steps (when ChatGPT workspace ready)

1. Confirm workspace supports custom MCP (read+write or read-only).  
2. Expose MCP over a reachable HTTPS host (Fly deferred; any public API URL works).  
3. Register with `MEMORY_OS_MCP_PROFILE=chatgpt`.  
4. Bind ChatGPT actor → subject via seed/`auth.bind` if using Supabase Auth later.  
5. Verify: golden-style query + store decision + Web timeline shows candidate.

## Tool sets

**ChatGPT pilot (read + write when allowed):**  
`memory.search`, `memory.get`, `context.project`, `capture.text`, `memory.store_decision`, `handoff.create`, `memory.set_status`

**Owner ops (do not expose to ChatGPT by default):**  
`oauth.*`, `outbox.*`, `jobs.dead_letter_stale`, `consolidation.run`, `memory.embed*`, `connections.*`, `extraction.*`

## Cursor / Claude stdio (mode C) — ready now

See [MCP_CURSOR.md](../engineering/MCP_CURSOR.md). Demo subject for ChatGPT actor: `33333333-3333-4333-8333-333333333302`.

```json
{
  "mcpServers": {
    "memory-os": {
      "command": "npx",
      "args": ["pnpm@9.15.9", "--filter", "@memory-os/mcp-gateway", "start"],
      "cwd": "/Users/alex/MAMORYOS/MAMORUOS"
    }
  }
}
```

## HTTP MCP (mode A host path)

```bash
# Profile for ChatGPT pilot surface
export MEMORY_OS_MCP_PROFILE=chatgpt

# With API
curl -sS http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'

# Smoke
./scripts/smoke-mcp-chatgpt.sh
```

Standalone: `pnpm --filter @memory-os/mcp-gateway start:http` → `POST http://127.0.0.1:8790/mcp`.

## Mode B write headers (HTTP / Web)

```http
x-subject-id: 33333333-3333-4333-8333-333333333302
x-actor-key: chatgpt
x-client-id: demo-chatgpt
```

Capture: `POST /v1/capture/text` · Decision: typed memory store via API/MCP · Review: Web control center.

## Fallback if write MCP unavailable

- Read via MCP tools only.  
- Writes via Web (`apps/web`) or HTTP `/v1/capture/*` / `/v1/memories` with ChatGPT subject headers.  
- Do **not** promise full ChatGPT write where the platform forbids it (baseline OUT).

## Owner accept

- [x] Confirmed ChatGPT plan/workspace MCP capability: **B now**; **A preferred** when write MCP available  
- [x] Accept fallback B if A write is unavailable  
- [x] Pilot project for first ChatGPT↔Memory OS loop chosen — `44444444-4444-4444-8444-444444444401`

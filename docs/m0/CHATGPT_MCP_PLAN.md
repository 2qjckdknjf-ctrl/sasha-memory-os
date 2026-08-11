# ChatGPT custom MCP plan (RG0)

Status: **working plan** — capability depends on OpenAI workspace/plan; code paths already support fallbacks.

**Alpha operating mode (until owner confirms A):** **B** — MCP/HTTP read + Web/HTTP write. HTTP MCP endpoint landed (`POST /mcp`) for when custom MCP write (A) becomes available.

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

## Integration steps (when ChatGPT workspace ready)

1. Confirm workspace supports custom MCP (read+write or read-only).  
2. Expose MCP over a reachable host (stdio bridge / remote MCP URL — product-dependent).  
3. Register tools below (ChatGPT pilot set first; owner-only later).  
4. Bind ChatGPT actor → subject via seed/`auth.bind` if using Supabase Auth later.  
5. Verify: golden-style query + store decision + Web timeline shows candidate.

## Tool sets

**ChatGPT pilot (read + write when allowed):**  
`memory.search`, `memory.get`, `context.project`, `capture.text`, `memory.store_decision`, `handoff.create`, `memory.set_status`

**Owner ops (do not expose to ChatGPT by default):**  
`oauth.*`, `outbox.*`, `jobs.dead_letter_stale`, `consolidation.run`, `memory.embed*`, `connections.*`

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

## HTTP MCP (mode A host path) — ready on API / standalone

```bash
# With API
curl -sS http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# Hosted (after Fly or any public API URL): POST {MEMORY_OS_API_BASE_URL}/mcp
# Bearer required outside local/test
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

- [ ] Confirmed ChatGPT plan/workspace MCP capability (A / B)  
- [ ] Accept fallback B if A write is unavailable  
- [ ] Pilot project for first ChatGPT↔Memory OS loop chosen

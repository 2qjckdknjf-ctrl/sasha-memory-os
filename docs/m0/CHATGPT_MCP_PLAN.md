# ChatGPT custom MCP plan (RG0)

Status: **working plan** — capability depends on OpenAI workspace/plan; code paths already support fallbacks.

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
3. Register tools: `memory.search`, `context.project`, `capture.text`, `memory.store_decision`, `handoff.create` (+ oauth/outbox only for owner).  
4. Bind ChatGPT actor → subject via seed/`auth.bind` if using Supabase Auth later.  
5. Verify: golden-style query + store decision + Web timeline shows candidate.

## Fallback if write MCP unavailable

- Read via MCP tools only.  
- Writes via Web (`apps/web`) or HTTP `/v1/capture/*` / `/v1/memories` with ChatGPT subject headers.  
- Do **not** promise full ChatGPT write where the platform forbids it (baseline OUT).

## Owner accept

- [ ] Confirmed ChatGPT plan/workspace MCP capability (A / B)  
- [ ] Accept fallback B if A write is unavailable  
- [ ] Pilot project for first ChatGPT↔Memory OS loop chosen

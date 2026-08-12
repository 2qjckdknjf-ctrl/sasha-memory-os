# MCP Gateway — Cursor / Claude Desktop / HTTP

Runnable stdio server:

```bash
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start
```

HTTP JSON-RPC (remote / ChatGPT when host reachable):

```bash
# Standalone :8790
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start:http
# Or via API (same process as HTTP API): POST http://localhost:8787/mcp
```

Outside `local`/`test`, send `Authorization: Bearer $MEMORY_OS_API_SECRET` or `x-memory-os-api-secret`.

Backend: Supabase when `MEMORY_OS_SUPABASE_*` + `MEMORY_OS_API_SECRET` are set in repo-root `.env`; otherwise in-memory store.

## Cursor `mcp.json` example

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

Tools include `memory.search` (hybrid RRF; optional `recorded_after`/`recorded_before`/`pack_context`), `memory.get`, `memory.export`, `memory.embed`, `memory.embed_missing`, `extraction.preview`, `extraction.apply`, `extraction.run`, `capture.*`, `connections.*`, `oauth.*`, `consolidation.run`, `outbox.*`, `jobs.get`, `jobs.dead_letter_stale`.

Pass `actor_subject_id` / `workspace_id` in tool args (demo UUIDs from README).

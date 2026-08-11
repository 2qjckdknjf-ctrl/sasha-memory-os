# MCP Gateway — Cursor / Claude Desktop

Runnable stdio server:

```bash
npx pnpm@9.15.9 --filter @memory-os/mcp-gateway start
```

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

Tools include `memory.search`, `memory.get`, `memory.embed`, `memory.embed_missing`, `capture.*`, `connections.*`, `oauth.*`, `consolidation.run`, `outbox.*`, `jobs.dead_letter_stale`.

Pass `actor_subject_id` / `workspace_id` in tool args (demo UUIDs from README).

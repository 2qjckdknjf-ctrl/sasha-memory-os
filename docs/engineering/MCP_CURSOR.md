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

**Profiles:** `MEMORY_OS_MCP_PROFILE=full` (default, Cursor/owner) or `chatgpt` (pilot tool allowlist + default subject/workspace only; writes keep explicit `project_id`). ChatGPT remote A: see [CHATGPT_MCP_PLAN.md](../m0/CHATGPT_MCP_PLAN.md) and `scripts/smoke-mcp-chatgpt.sh`.

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

## M18.1 substantial-task bootstrap

Cursor project sessions load the always-on rule at `.cursor/rules/memory-os-lifecycle.mdc` and the `sessionStart` hook in `.cursor/hooks.json`. Before any substantial task, run:

```bash
node scripts/cursor-mcp-session.mjs bootstrap \
  --project-id 44444444-4444-4444-8444-444444444402
```

This searches the canonical completion plan and current project context, reads the latest decisions through `context.project`, fetches `origin/main`, and emits a bounded planning envelope. After the PR is merged, use `store-decision`; it now performs `memory.get` automatically and returns `readAfterWrite.verified=true` only when the exact milestone is readable in the same project.

Full contract: [M18_SLICE_01.md](M18_SLICE_01.md).

# Demo slice: decision → state → MCP → handoff

In-memory path (no Docker/Supabase required):

1. Seeded decision + project state in `MemoryStore` (`@memory-os/domain`).
2. HTTP API (`apps/api`) exposes `/v1/projects/:id/context`, state, memories, handoffs, search.
3. MCP alpha (`apps/mcp-gateway`) tools: `memory.search`, `context.project`, `memory.store_decision`, `handoff.create`.
4. AuthZ stub mirrors seed ACL (ChatGPT write, Cursor project read + handoff).

Synthetic IDs (RFC UUID):

| Entity | UUID |
|---|---|
| Workspace | `11111111-1111-4111-8111-111111111111` |
| Project AISTROYKA | `44444444-4444-4444-8444-444444444401` |
| Owner | `33333333-3333-4333-8333-333333333301` |
| ChatGPT | `33333333-3333-4333-8333-333333333302` |
| Cursor | `33333333-3333-4333-8333-333333333303` |

Pass actor as `x-subject-id` header on API requests.

SQL path: apply `supabase/migrations/*` + `supabase/seed.sql` when local Supabase/Docker is available (CLI currently blocked on this machine: x86_64 binary).

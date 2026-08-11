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

Text capture alpha: `POST /v1/capture/text` (owner/ChatGPT) creates quarantine artifact → SHA-256 → ingest job → chunks → `candidate` fact with evidence. Process via `process_now` (default) or `POST /v1/jobs/:id/process` / worker CLI.

Document capture alpha: `POST /v1/capture/document` accepts base64 `.txt` / `.pdf` / `.docx`, extracts text via `@memory-os/ingestion`, then reuses the same ingest pipeline.

Link capture alpha: `POST /v1/capture/link` fetches public http(s) URLs after DNS/SSRF checks (no private IPs, no credentialed URLs, redirects disabled).

SQL path: migrations are applied to live project `sasha-memory-os` (see [SUPABASE.md](./SUPABASE.md)). Local CLI currently blocked on this machine (x86_64 binary).

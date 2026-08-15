#!/usr/bin/env bash
# Deploy the durable ChatGPT MCP adapter to the dedicated Sasha Memory OS Supabase project.
# The function uses custom Memory OS API-secret auth, so platform JWT verification stays disabled.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_REF="${MEMORY_OS_PROJECT_REF:-vpxblcxsvlylqyldiuwr}"

npx supabase functions deploy memory-mcp \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api

BASE="https://${PROJECT_REF}.supabase.co/functions/v1/memory-mcp"
echo "Deployed Sasha Memory OS MCP Edge Function."
echo "Health: ${BASE}/health"
echo "MCP:    ${BASE}/mcp"
echo "Run authenticated smoke with MEMORY_OS_API_BASE_URL=${BASE} and MEMORY_OS_API_SECRET set outside the repo."

#!/usr/bin/env bash
# Expose local Memory OS API over a public HTTPS URL (ChatGPT remote MCP A).
# Requires local API on MEMORY_OS_API_BASE_URL (default http://localhost:8787).
# Uses Cloudflare quick tunnel via npx (no account required for trycloudflare).
#
# Usage:
#   ./scripts/tunnel-api.sh
# Then in ChatGPT Developer mode: MCP URL = https://….trycloudflare.com/mcp
# With server: MEMORY_OS_MCP_PROFILE=chatgpt MEMORY_OS_REQUIRE_API_AUTH=1
set -euo pipefail
TARGET="${MEMORY_OS_API_BASE_URL:-http://localhost:8787}"
echo "Tunneling ${TARGET} (Ctrl+C to stop)"
echo "Point ChatGPT MCP at: https://<printed-host>/mcp"
echo "Auth: Bearer \$MEMORY_OS_API_SECRET (outside local/test)"
exec npx --yes cloudflared tunnel --url "$TARGET"

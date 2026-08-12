#!/usr/bin/env bash
# Optional / deferred: host full Node HTTP API on Fly.
# Current ops use Supabase Edge worker-ticks + GH Node workers — Fly is not required.
# If needed later: flyctl auth login (or FLY_API_TOKEN) + local .env, then run this script.
# After deploy you may point MEMORY_OS_API_BASE_URL at the Fly hostname.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.fly/bin:${PATH}"

if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl missing — install: curl -L https://fly.io/install.sh | sh" >&2
  exit 1
fi

if ! flyctl auth whoami >/dev/null 2>&1; then
  echo "Not logged in to Fly. Run: flyctl auth login" >&2
  echo "Or set FLY_API_TOKEN from https://fly.io/user/personal_access_tokens" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing .env (copy from .env.example and fill secrets)" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${MEMORY_OS_API_SECRET:?MEMORY_OS_API_SECRET required}"
: "${MEMORY_OS_SUPABASE_URL:?MEMORY_OS_SUPABASE_URL required}"
: "${MEMORY_OS_SUPABASE_ANON_KEY:?MEMORY_OS_SUPABASE_ANON_KEY required}"

flyctl apps create sasha-memory-os-api --org personal 2>/dev/null || true

flyctl secrets set \
  MEMORY_OS_ENV=staging \
  MEMORY_OS_API_SECRET="$MEMORY_OS_API_SECRET" \
  MEMORY_OS_SUPABASE_URL="$MEMORY_OS_SUPABASE_URL" \
  MEMORY_OS_SUPABASE_ANON_KEY="$MEMORY_OS_SUPABASE_ANON_KEY" \
  MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY="${MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY:-}" \
  MEMORY_OS_VAULT_BACKEND="${MEMORY_OS_VAULT_BACKEND:-supabase}" \
  MEMORY_OS_VAULT_KEY="${MEMORY_OS_VAULT_KEY:-}" \
  MEMORY_OS_EMBED_ENGINE="${MEMORY_OS_EMBED_ENGINE:-stub}" \
  MEMORY_OS_OPENAI_API_KEY="${MEMORY_OS_OPENAI_API_KEY:-}" \
  MEMORY_OS_CONNECTOR_PULL_MODE="${MEMORY_OS_CONNECTOR_PULL_MODE:-auto}" \
  --app sasha-memory-os-api

flyctl deploy --config fly.toml --remote-only

APP_URL="$(flyctl status --app sasha-memory-os-api -j 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Hostname") or d.get("Hostname") or "")' 2>/dev/null || true)"
if [[ -z "$APP_URL" ]]; then
  APP_URL="sasha-memory-os-api.fly.dev"
fi
BASE="https://${APP_URL#https://}"
echo "Deployed. Smoke: MEMORY_OS_API_BASE_URL=$BASE ./scripts/smoke-api.sh"
echo "Set GH secret for cron:"
echo "  printf '%s' '$BASE' | gh secret set MEMORY_OS_API_BASE_URL --repo 2qjckdknjf-ctrl/sasha-memory-os"

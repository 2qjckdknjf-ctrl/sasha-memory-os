#!/usr/bin/env bash
# Apply a SQL migration file to the live Supabase project via Management API.
# Requires: SUPABASE_ACCESS_TOKEN (sbp_… from `npx supabase login` / dashboard).
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_… ./scripts/apply-remote-migration.sh \
#     supabase/migrations/20260812083002_search_rrf_temporal.sql
set -euo pipefail
FILE="${1:-}"
REF="${MEMORY_OS_PROJECT_REF:-vpxblcxsvlylqyldiuwr}"
NAME="${2:-}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "SUPABASE_ACCESS_TOKEN is required (npx supabase login → access token)" >&2
  exit 1
fi
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <migration.sql> [migration_name]" >&2
  exit 1
fi
if [[ -z "$NAME" ]]; then
  base="$(basename "$FILE" .sql)"
  NAME="${base#*_}"
fi

echo "Applying migration name=${NAME} project=${REF} file=${FILE}"

BODY=$(python3 - <<'PY' "$NAME" "$FILE"
import json, sys
name, path = sys.argv[1], sys.argv[2]
query = open(path, encoding="utf-8").read()
print(json.dumps({"name": name, "query": query}))
PY
)

code=$(curl -sS -o /tmp/memory-os-mig-resp.json -w '%{http_code}' \
  -X POST "https://api.supabase.com/v1/projects/${REF}/database/migrations" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")

if [[ "$code" != "200" && "$code" != "201" ]]; then
  echo "migrations endpoint HTTP ${code}; trying database/query …" >&2
  QUERY_BODY=$(python3 - <<'PY' "$FILE"
import json, sys
print(json.dumps({"query": open(sys.argv[1], encoding="utf-8").read()}))
PY
)
  code=$(curl -sS -o /tmp/memory-os-mig-resp.json -w '%{http_code}' \
    -X POST "https://api.supabase.com/v1/projects/${REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$QUERY_BODY")
fi

echo "HTTP ${code}"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/tmp/memory-os-mig-resp.json")
text = p.read_text(encoding="utf-8") if p.exists() else ""
try:
    print(json.dumps(json.loads(text), indent=2)[:4000])
except Exception:
    print(text[:4000])
PY

if [[ "$code" != "200" && "$code" != "201" ]]; then
  exit 1
fi
echo "apply-remote-migration ok"

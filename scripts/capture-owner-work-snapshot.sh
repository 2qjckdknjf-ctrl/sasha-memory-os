#!/usr/bin/env bash
# Persist the owner work snapshot into Memory OS via public.api_* RPCs.
# Primary path: Supabase PostgREST (MEMORY_OS_SUPABASE_URL + anon + API secret).
# Optional fallback: HTTP API MEMORY_OS_API_BASE_URL /v1/capture/text and /v1/memories.
#
# Usage:
#   ./scripts/capture-owner-work-snapshot.sh --dry-run
#   MEMORY_OS_SUPABASE_URL=… MEMORY_OS_SUPABASE_ANON_KEY=… MEMORY_OS_API_SECRET=… \
#     ./scripts/capture-owner-work-snapshot.sh
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_PATH="${SNAPSHOT_PATH:-$ROOT/docs/engineering/owner-work-snapshot/2026-08-29.json}"
RESULT_PATH="${RESULT_PATH:-/tmp/memory-os-owner-work-capture.json}"
DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

if [[ ! -f "$SNAPSHOT_PATH" ]]; then
  echo "snapshot not found: $SNAPSHOT_PATH" >&2
  exit 1
fi

python3 - "$SNAPSHOT_PATH" <<'PY'
import json, sys
from pathlib import Path

forbidden = (
    "44444444-4444-4444-8444-444444444401",
    "service_role",
    "MEMORY_OS_API_SECRET",
    "BEGIN PRIVATE",
)
allowed_kinds = {"capture_text", "create_decision"}
canonical_project = "44444444-4444-4444-8444-444444444402"
canonical_workspace = "11111111-1111-4111-8111-111111111111"

raw = Path(sys.argv[1]).read_text(encoding="utf-8")
lower = raw.lower()
for token in forbidden:
    if token.lower() in lower and token != "MEMORY_OS_API_SECRET":
        if token == "44444444-4444-4444-8444-444444444401":
            # AISTROYKA may be mentioned as a negative example, but never as projectId.
            pass
        elif "begin private" in lower:
            raise SystemExit("snapshot must not contain private key material")

data = json.loads(raw)
if data.get("projectId") != canonical_project:
    raise SystemExit("snapshot projectId must be the canonical Memory OS project")
if data.get("workspaceId") != canonical_workspace:
    raise SystemExit("snapshot workspaceId mismatch")
if data.get("projectId") == "44444444-4444-4444-8444-444444444401":
    raise SystemExit("refusing AISTROYKA project write")

memories = data.get("memories")
if not isinstance(memories, list) or not memories:
    raise SystemExit("snapshot memories[] required")

keys = []
for item in memories:
    kind = item.get("kind")
    if kind not in allowed_kinds:
        raise SystemExit(f"unsupported memory kind: {kind}")
    if not item.get("title") or not item.get("idempotencyKey"):
        raise SystemExit("each memory needs title and idempotencyKey")
    body = item.get("text") if kind == "capture_text" else item.get("content")
    if not body:
        raise SystemExit(f"missing body for {item.get('title')}")
    if item.get("projectId") == "44444444-4444-4444-8444-444444444401":
        raise SystemExit("refusing AISTROYKA per-memory projectId")
    keys.append(item["idempotencyKey"])
if len(keys) != len(set(keys)):
    raise SystemExit("idempotency keys must be unique")
print(f"snapshot_ok memories={len(memories)}")
PY

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry_run=ok path=$SNAPSHOT_PATH"
  exit 0
fi

if [[ -z "${MEMORY_OS_SUPABASE_URL:-}" || -z "${MEMORY_OS_SUPABASE_ANON_KEY:-}" || -z "${MEMORY_OS_API_SECRET:-}" ]]; then
  if [[ -n "${MEMORY_OS_API_BASE_URL:-}" && -n "${MEMORY_OS_API_SECRET:-}" ]]; then
    echo "using HTTP API fallback ${MEMORY_OS_API_BASE_URL}"
  else
    echo "live capture requires MEMORY_OS_SUPABASE_URL + MEMORY_OS_SUPABASE_ANON_KEY + MEMORY_OS_API_SECRET" >&2
    echo "(or MEMORY_OS_API_BASE_URL + MEMORY_OS_API_SECRET)" >&2
    exit 1
  fi
fi

python3 - "$SNAPSHOT_PATH" "$RESULT_PATH" <<'PY'
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

snapshot_path = Path(sys.argv[1])
result_path = Path(sys.argv[2])
data = json.loads(snapshot_path.read_text(encoding="utf-8"))

supabase_url = (os.environ.get("MEMORY_OS_SUPABASE_URL") or "").rstrip("/")
anon = os.environ.get("MEMORY_OS_SUPABASE_ANON_KEY") or ""
api_secret = os.environ.get("MEMORY_OS_API_SECRET") or ""
api_base = (os.environ.get("MEMORY_OS_API_BASE_URL") or "").rstrip("/")
subject = data["actorSubjectId"]
workspace = data["workspaceId"]
project = data["projectId"]

def post_json(url: str, payload: dict, headers: dict) -> tuple[int, object]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            parsed: object
            try:
                parsed = json.loads(body) if body else {}
            except json.JSONDecodeError:
                parsed = {"raw": "unparsed"}
            return resp.status, parsed
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        snippet = raw.replace(api_secret, "[redacted]")[:400] if api_secret else raw[:400]
        return err.code, {"error": snippet}

def capture_via_rpc(item: dict) -> tuple[int, object]:
    if item["kind"] == "capture_text":
        url = f"{supabase_url}/rest/v1/rpc/api_capture_text"
        payload = {
            "p_secret": api_secret,
            "p_subject_id": subject,
            "p_workspace_id": workspace,
            "p_project_id": project,
            "p_title": item["title"],
            "p_text": item["text"],
            "p_idempotency_key": item["idempotencyKey"],
            "p_sensitivity": item.get("sensitivity", "internal"),
            "p_process_now": True,
        }
    elif item["kind"] == "create_decision":
        url = f"{supabase_url}/rest/v1/rpc/api_create_decision"
        payload = {
            "p_secret": api_secret,
            "p_subject_id": subject,
            "p_workspace_id": workspace,
            "p_project_id": project,
            "p_title": item["title"],
            "p_content": item["content"],
            "p_idempotency_key": item["idempotencyKey"],
            "p_importance": item.get("importance", 0.8),
            "p_confidence": item.get("confidence", 0.9),
            "p_sensitivity": item.get("sensitivity", "internal"),
            "p_rationale": item.get("rationale"),
        }
    else:
        raise SystemExit(f"unsupported kind {item['kind']}")
    headers = {
        "content-type": "application/json",
        "apikey": anon,
        "authorization": f"Bearer {anon}",
    }
    return post_json(url, payload, headers)

def capture_via_http(item: dict) -> tuple[int, object]:
    headers = {
        "content-type": "application/json",
        "x-subject-id": subject,
        "x-actor-key": "owner",
        "x-client-id": "demo-owner",
        "x-memory-os-api-secret": api_secret,
    }
    if item["kind"] == "capture_text":
        url = f"{api_base}/v1/capture/text"
        payload = {
            "workspace_id": workspace,
            "project_id": project,
            "title": item["title"],
            "text": item["text"],
            "sensitivity": item.get("sensitivity", "internal"),
            "actor_subject_id": subject,
            "idempotency_key": item["idempotencyKey"],
            "process_now": True,
        }
    elif item["kind"] == "create_decision":
        url = f"{api_base}/v1/memories"
        payload = {
            "workspace_id": workspace,
            "project_id": project,
            "title": item["title"],
            "content": item["content"],
            "rationale": item.get("rationale"),
            "importance": item.get("importance", 0.8),
            "confidence": item.get("confidence", 0.9),
            "sensitivity": item.get("sensitivity", "internal"),
            "actor_subject_id": subject,
            "idempotency_key": item["idempotencyKey"],
        }
    else:
        raise SystemExit(f"unsupported kind {item['kind']}")
    return post_json(url, payload, headers)

use_rpc = bool(supabase_url and anon and api_secret)
results = []
failed = 0
for item in data["memories"]:
    if use_rpc:
        status, body = capture_via_rpc(item)
    else:
        status, body = capture_via_http(item)
    memory_id = None
    if isinstance(body, dict):
        process = body.get("process")
        if isinstance(process, dict):
            memory_id = process.get("memoryId") or process.get("memory_id")
        nested = body.get("memory")
        nested_id = nested.get("id") if isinstance(nested, dict) else None
        memory_id = memory_id or body.get("memoryId") or body.get("id") or nested_id
    ok = 200 <= status < 300
    if not ok:
        failed += 1
    row = {
        "title": item["title"],
        "kind": item["kind"],
        "idempotencyKey": item["idempotencyKey"],
        "httpStatus": status,
        "memoryId": memory_id,
        "ok": ok,
    }
    results.append(row)
    print(
        f"{'ok' if ok else 'fail'} status={status} kind={item['kind']} "
        f"memory_id={memory_id or 'none'} title={item['title']}"
    )

summary = {
    "ok": failed == 0,
    "failed": failed,
    "count": len(results),
    "projectId": project,
    "workspaceId": workspace,
    "results": results,
}
result_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(f"wrote {result_path} failed={failed}")
if failed:
    raise SystemExit(1)
PY

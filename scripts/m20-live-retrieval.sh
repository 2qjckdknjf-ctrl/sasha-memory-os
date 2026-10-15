#!/usr/bin/env bash
set -euo pipefail

: "${MEMORY_OS_API_BASE_URL:?MEMORY_OS_API_BASE_URL is required}"
: "${MEMORY_OS_API_SECRET:?MEMORY_OS_API_SECRET is required}"
: "${MEMORY_OS_PROJECT_ID:?MEMORY_OS_PROJECT_ID is required}"

exec npx tsx apps/api/src/m20LiveRetrieval.cli.ts

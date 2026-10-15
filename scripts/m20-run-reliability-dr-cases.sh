#!/usr/bin/env bash
# Provision AES-GCM test credentials, prove the exact database ciphertext can
# be opened by the worker vault codec, then run the transactional M20.2 drill.
set -euo pipefail

: "${DB_URL:?DB_URL is required}"

ready_ref='vault:test/m20/reliability'
recovery_ref='vault:ci/connectors/github/99999999-0000-4000-8000-000000000020'
vault_secret="${MEMORY_OS_VAULT_KEY:-${MEMORY_OS_API_SECRET:-ci-ephemeral-secret}}"

seal_fixture() {
  MEMORY_OS_ENV=local \
  MEMORY_OS_VAULT_KEY="$vault_secret" \
    CI=1 npx --yes pnpm@9.15.9 exec tsx scripts/m20-vault-fixture.ts seal "$1"
}

verify_fixture() {
  MEMORY_OS_ENV=local \
  MEMORY_OS_VAULT_KEY="$vault_secret" \
    CI=1 npx --yes pnpm@9.15.9 exec tsx scripts/m20-vault-fixture.ts verify "$1"
}

ready_ciphertext="$(seal_fixture "$ready_ref")"
recovery_ciphertext="$(seal_fixture "$recovery_ref")"

cleanup() {
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
    -v ready_ref="$ready_ref" \
    -v recovery_ref="$recovery_ref" \
    >/dev/null 2>&1 <<'SQL' || true
DELETE FROM public.connector_vault_blobs
WHERE vault_ref IN (:'ready_ref', :'recovery_ref');
SQL
}
trap cleanup EXIT

psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -v ready_ref="$ready_ref" \
  -v recovery_ref="$recovery_ref" \
  -v ready_ciphertext="$ready_ciphertext" \
  -v recovery_ciphertext="$recovery_ciphertext" \
  <<'SQL'
INSERT INTO public.connector_vault_blobs (vault_ref, ciphertext, updated_at)
VALUES
  (:'ready_ref', decode(:'ready_ciphertext', 'base64'), now()),
  (:'recovery_ref', decode(:'recovery_ciphertext', 'base64'), now())
ON CONFLICT (vault_ref) DO UPDATE
SET ciphertext = EXCLUDED.ciphertext,
    updated_at = now();
SQL

for ref in "$ready_ref" "$recovery_ref"; do
  ciphertext="$(psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -v vault_ref="$ref" \
    <<'SQL'
SELECT encode(ciphertext, 'base64')
FROM public.connector_vault_blobs
WHERE vault_ref = :'vault_ref';
SQL
)"
  printf '%s' "$ciphertext" | verify_fixture "$ref"
done
echo 'm20_vault_fixture_read=pass algorithm=aes-256-gcm payload_logged=false'

psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -f tests/security/m20_reliability_dr_cases.sql


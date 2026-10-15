import { openVaultRecord, sealVaultRecord } from '../packages/connector-sdk/src/vault.js';

const [mode, vaultRef] = process.argv.slice(2);

if ((mode !== 'seal' && mode !== 'verify') || !vaultRef?.trim()) {
  throw new Error('usage: m20-vault-fixture.ts <seal|verify> <vault-ref>');
}

const expected = {
  vaultRef,
  accessToken: `m20-ci-token:${vaultRef}`,
  refreshToken: 'm20-ci-refresh-token',
  tokenType: 'Bearer',
  expiresAt: '2030-01-01T00:00:00.000Z',
  scope: 'repositories.read',
  provider: 'github',
  storedAt: '2026-10-15T00:00:00.000Z',
};

if (mode === 'seal') {
  const ciphertext = sealVaultRecord(expected, process.env);
  const opened = openVaultRecord(ciphertext, process.env);
  if (JSON.stringify(opened) !== JSON.stringify(expected)) {
    throw new Error('sealed M20 vault fixture did not round-trip');
  }
  process.stdout.write(ciphertext);
} else {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const ciphertext = Buffer.concat(chunks).toString('utf8').trim();
  const opened = openVaultRecord(ciphertext, process.env);
  if (JSON.stringify(opened) !== JSON.stringify(expected)) {
    throw new Error('database M20 vault fixture did not decrypt to the expected record');
  }
}


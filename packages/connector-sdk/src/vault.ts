import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type VaultTokenRecord = {
  vaultRef: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
  provider: string;
  storedAt: string;
};

export type VaultStore = {
  put(record: VaultTokenRecord): Promise<void>;
  get(vaultRef: string): Promise<VaultTokenRecord | null>;
  delete(vaultRef: string): Promise<void>;
};

function resolveVaultDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MEMORY_OS_VAULT_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), '.data', 'vault');
}

export function resolveVaultKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const dedicated = env.MEMORY_OS_VAULT_KEY?.trim();
  if (dedicated) {
    return createHash('sha256').update(dedicated, 'utf8').digest();
  }

  const envName = (env.MEMORY_OS_ENV ?? 'local').trim().toLowerCase();
  const allowFallback =
    env.MEMORY_OS_VAULT_ALLOW_API_SECRET_FALLBACK === '1' ||
    envName === 'local' ||
    envName === 'test';

  if (!allowFallback) {
    throw new Error(
      'MEMORY_OS_VAULT_KEY is required outside local/test (do not reuse API secret)',
    );
  }

  const fallback =
    env.MEMORY_OS_API_SECRET?.trim() || 'local-dev-vault-key-not-for-production';
  return createHash('sha256').update(fallback, 'utf8').digest();
}

function fileNameForRef(vaultRef: string): string {
  return createHash('sha256').update(vaultRef, 'utf8').digest('hex') + '.bin';
}

export function encryptVaultPayload(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptVaultPayload(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const encrypted = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/** Encrypt token record to base64 ciphertext (iv|tag|payload). */
export function sealVaultRecord(
  record: VaultTokenRecord,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = resolveVaultKey(env);
  return encryptVaultPayload(JSON.stringify(record), key).toString('base64');
}

/** Decrypt base64 ciphertext back to token record. */
export function openVaultRecord(
  ciphertextBase64: string,
  env: NodeJS.ProcessEnv = process.env,
): VaultTokenRecord {
  const key = resolveVaultKey(env);
  const blob = Buffer.from(ciphertextBase64, 'base64');
  return JSON.parse(decryptVaultPayload(blob, key)) as VaultTokenRecord;
}

/**
 * Remote/shared vault via opaque ciphertext transport (e.g. Supabase RPCs).
 * Plaintext tokens never leave the encrypting process unencrypted.
 */
export function createCiphertextVaultStore(input: {
  putCiphertext: (vaultRef: string, ciphertextBase64: string) => Promise<void>;
  getCiphertext: (vaultRef: string) => Promise<string | null>;
  deleteCiphertext: (vaultRef: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
}): VaultStore {
  const processEnv = input.env ?? process.env;
  return {
    async put(record) {
      await input.putCiphertext(record.vaultRef, sealVaultRecord(record, processEnv));
    },
    async get(vaultRef) {
      const ciphertext = await input.getCiphertext(vaultRef);
      if (!ciphertext) return null;
      const parsed = openVaultRecord(ciphertext, processEnv);
      if (parsed.vaultRef !== vaultRef) return null;
      return parsed;
    },
    async delete(vaultRef) {
      await input.deleteCiphertext(vaultRef);
    },
  };
}

/** Local AES-GCM file vault. */
export function createLocalVaultStore(
  env: NodeJS.ProcessEnv = process.env,
): VaultStore {
  const dir = resolveVaultDir(env);
  const key = resolveVaultKey(env);

  return {
    async put(record) {
      await mkdir(dir, { recursive: true });
      const payload = JSON.stringify(record);
      const blob = encryptVaultPayload(payload, key);
      await writeFile(path.join(dir, fileNameForRef(record.vaultRef)), blob);
    },
    async get(vaultRef) {
      try {
        const blob = await readFile(path.join(dir, fileNameForRef(vaultRef)));
        const parsed = JSON.parse(decryptVaultPayload(blob, key)) as VaultTokenRecord;
        if (parsed.vaultRef !== vaultRef) return null;
        return parsed;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return null;
        throw err;
      }
    },
    async delete(vaultRef) {
      try {
        await unlink(path.join(dir, fileNameForRef(vaultRef)));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
      }
    },
  };
}

import { createHash } from 'node:crypto';
import {
  CONNECTOR_OAUTH_DEFAULTS,
  resolveOAuthClientId,
  vaultRefForAccount,
} from './oauth.js';

export type TokenExchangeResult = {
  vaultRef: string;
  /** Tokens never written to Postgres — only vault refs. */
  tokenPersisted: false;
  exchangeMode: 'stub' | 'credentials_ready';
  codeFingerprint: string | null;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  note: string;
};

const CLIENT_SECRET_ENV: Record<string, string> = {
  github: 'MEMORY_OS_OAUTH_GITHUB_CLIENT_SECRET',
  'google-drive': 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_SECRET',
  gmail: 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_SECRET',
  'google-calendar': 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_SECRET',
};

export function resolveOAuthClientSecret(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = CLIENT_SECRET_ENV[connectorId];
  if (!key) return null;
  const value = env[key];
  return value && value.trim() ? value.trim() : null;
}

export function fingerprintAuthorizationCode(code: string | null | undefined): string | null {
  if (!code || !code.trim()) return null;
  return createHash('sha256').update(code.trim(), 'utf8').digest('hex').slice(0, 16);
}

/**
 * Local token-exchange broker stub.
 * Never returns or persists access/refresh tokens — only a vault ref + fingerprints.
 * When CLIENT_ID+SECRET are set, mode becomes credentials_ready for a future HTTP exchange.
 */
export function exchangeAuthorizationCode(input: {
  connectorId: string;
  connectionId: string;
  code?: string | null;
  envName?: string;
  env?: NodeJS.ProcessEnv;
}): TokenExchangeResult {
  const processEnv = input.env ?? process.env;
  const envName = input.envName ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const clientIdConfigured = Boolean(resolveOAuthClientId(input.connectorId, processEnv));
  const clientSecretConfigured = Boolean(
    resolveOAuthClientSecret(input.connectorId, processEnv),
  );
  const known = Boolean(CONNECTOR_OAUTH_DEFAULTS[input.connectorId]);
  const vaultRef = vaultRefForAccount({
    env: envName,
    connectorId: input.connectorId,
    accountId: input.connectionId,
  });
  const codeFingerprint = fingerprintAuthorizationCode(input.code);
  const credentialsReady =
    known && clientIdConfigured && clientSecretConfigured && Boolean(codeFingerprint);

  return {
    vaultRef,
    tokenPersisted: false,
    exchangeMode: credentialsReady ? 'credentials_ready' : 'stub',
    codeFingerprint,
    clientIdConfigured,
    clientSecretConfigured,
    note: credentialsReady
      ? 'client credentials present; HTTP token exchange not yet wired — vault ref reserved'
      : 'stub exchange; configure CLIENT_ID+CLIENT_SECRET for provider-ready mode',
  };
}

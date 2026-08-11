import { createHash } from 'node:crypto';
import {
  CONNECTOR_OAUTH_DEFAULTS,
  resolveOAuthClientId,
  vaultRefForAccount,
} from './oauth.js';
import type { VaultStore } from './vault.js';
import { createVaultStore } from './vaultFactory.js';

export type TokenExchangeMode = 'stub' | 'credentials_ready' | 'exchanged';

export type TokenExchangeResult = {
  vaultRef: string;
  /** Tokens never written to Postgres — only vault refs. */
  tokenPersisted: false;
  exchangeMode: TokenExchangeMode;
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

const TOKEN_URL: Record<string, string> = {
  github: 'https://github.com/login/oauth/access_token',
  'google-drive': 'https://oauth2.googleapis.com/token',
  gmail: 'https://oauth2.googleapis.com/token',
  'google-calendar': 'https://oauth2.googleapis.com/token',
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

function isGoogleConnector(connectorId: string): boolean {
  return (
    connectorId === 'google-drive' ||
    connectorId === 'gmail' ||
    connectorId === 'google-calendar'
  );
}

async function requestProviderTokens(input: {
  connectorId: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string | null;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
}): Promise<{
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
}> {
  const tokenUrl =
    input.env.MEMORY_OS_OAUTH_TOKEN_URL?.trim() || TOKEN_URL[input.connectorId];
  if (!tokenUrl) {
    throw new Error(`no token URL for connector ${input.connectorId}`);
  }

  const body = new URLSearchParams();
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('code', input.code);

  if (isGoogleConnector(input.connectorId)) {
    const redirectUri =
      input.redirectUri?.trim() ||
      input.env.MEMORY_OS_OAUTH_REDIRECT_URI?.trim() ||
      '';
    if (!redirectUri) {
      throw new Error('redirect_uri required for Google OAuth token exchange');
    }
    body.set('redirect_uri', redirectUri);
    body.set('grant_type', 'authorization_code');
  }

  const response = await input.fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(`oauth token exchange failed: ${detail}`);
  }

  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : null;
  if (!accessToken) {
    throw new Error('oauth token exchange failed: missing access_token');
  }

  const expiresIn =
    typeof payload.expires_in === 'number'
      ? payload.expires_in
      : typeof payload.expires_in === 'string'
        ? Number(payload.expires_in)
        : NaN;

  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : null,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
  };
}

/** Refresh an expired access token using the provider token endpoint. */
export async function refreshOAuthAccessToken(input: {
  connectorId: string;
  refreshToken: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
  scope?: string | null;
}> {
  const processEnv = input.env ?? process.env;
  const clientId = resolveOAuthClientId(input.connectorId, processEnv);
  const clientSecret = resolveOAuthClientSecret(input.connectorId, processEnv);
  if (!clientId || !clientSecret) {
    throw new Error(
      `cannot refresh ${input.connectorId}: CLIENT_ID/CLIENT_SECRET missing`,
    );
  }
  const tokenUrl =
    processEnv.MEMORY_OS_OAUTH_TOKEN_URL?.trim() || TOKEN_URL[input.connectorId];
  if (!tokenUrl) {
    throw new Error(`no token URL for connector ${input.connectorId}`);
  }
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', input.refreshToken);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : typeof payload.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(`oauth refresh failed: ${detail}`);
  }
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : null;
  if (!accessToken) {
    throw new Error('oauth refresh failed: missing access_token');
  }
  const expiresIn =
    typeof payload.expires_in === 'number'
      ? payload.expires_in
      : typeof payload.expires_in === 'string'
        ? Number(payload.expires_in)
        : NaN;
  return {
    accessToken,
    refreshToken:
      typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : input.refreshToken,
    tokenType: typeof payload.token_type === 'string' ? payload.token_type : null,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
  };
}

/**
 * OAuth authorization-code broker.
 * Never returns or persists access/refresh tokens in Postgres — only a vault ref + fingerprints.
 * When CLIENT_ID+SECRET+code are set, performs HTTP exchange and stores tokens in local vault/KMS.
 */
export async function exchangeAuthorizationCode(input: {
  connectorId: string;
  connectionId: string;
  code?: string | null;
  redirectUri?: string | null;
  envName?: string;
  env?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  /** When true, only report credentials_ready — do not call provider or vault. */
  dryRun?: boolean;
}): Promise<TokenExchangeResult> {
  const processEnv = input.env ?? process.env;
  const envName = input.envName ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const clientId = resolveOAuthClientId(input.connectorId, processEnv);
  const clientSecret = resolveOAuthClientSecret(input.connectorId, processEnv);
  const clientIdConfigured = Boolean(clientId);
  const clientSecretConfigured = Boolean(clientSecret);
  const known = Boolean(CONNECTOR_OAUTH_DEFAULTS[input.connectorId]);
  const vaultRef = vaultRefForAccount({
    env: envName,
    connectorId: input.connectorId,
    accountId: input.connectionId,
  });
  const codeFingerprint = fingerprintAuthorizationCode(input.code);
  const credentialsReady =
    known && clientIdConfigured && clientSecretConfigured && Boolean(codeFingerprint);

  if (!credentialsReady) {
    return {
      vaultRef,
      tokenPersisted: false,
      exchangeMode: 'stub',
      codeFingerprint,
      clientIdConfigured,
      clientSecretConfigured,
      note: 'stub exchange; configure CLIENT_ID+CLIENT_SECRET for provider-ready mode',
    };
  }

  if (input.dryRun) {
    return {
      vaultRef,
      tokenPersisted: false,
      exchangeMode: 'credentials_ready',
      codeFingerprint,
      clientIdConfigured,
      clientSecretConfigured,
      note: 'client credentials present; dry-run — HTTP token exchange skipped',
    };
  }

  const tokens = await requestProviderTokens({
    connectorId: input.connectorId,
    code: input.code!.trim(),
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: input.redirectUri,
    env: processEnv,
    fetchImpl: input.fetchImpl ?? fetch,
  });

  const vault =
    input.vault ??
    createVaultStore({
      env: {
        ...processEnv,
        // Unit paths without a shared gateway must not default to supabase.
        MEMORY_OS_VAULT_BACKEND:
          processEnv.MEMORY_OS_VAULT_BACKEND?.trim() || 'local',
      },
    });
  await vault.put({
    vaultRef,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? null,
    tokenType: tokens.tokenType ?? null,
    expiresAt: tokens.expiresAt ?? null,
    scope: tokens.scope ?? null,
    provider: input.connectorId,
    storedAt: new Date().toISOString(),
  });

  return {
    vaultRef,
    tokenPersisted: false,
    exchangeMode: 'exchanged',
    codeFingerprint,
    clientIdConfigured,
    clientSecretConfigured,
    note: 'HTTP token exchange completed; tokens stored in vault (not Postgres)',
  };
}

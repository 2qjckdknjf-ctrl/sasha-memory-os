export type OAuthProviderConfig = {
  connectorId: string;
  authorizeUrlEnv?: string;
  clientIdEnv?: string;
  defaultScopes: string[];
};

const DEFAULT_AUTHORIZE: Record<string, string> = {
  github: 'https://github.com/login/oauth/authorize',
  'google-drive': 'https://accounts.google.com/o/oauth2/v2/auth',
  gmail: 'https://accounts.google.com/o/oauth2/v2/auth',
  'google-calendar': 'https://accounts.google.com/o/oauth2/v2/auth',
};

export const CONNECTOR_OAUTH_DEFAULTS: Record<string, OAuthProviderConfig> = {
  github: {
    connectorId: 'github',
    authorizeUrlEnv: 'MEMORY_OS_OAUTH_GITHUB_AUTHORIZE_URL',
    clientIdEnv: 'MEMORY_OS_OAUTH_GITHUB_CLIENT_ID',
    defaultScopes: ['repositories.read', 'pull_requests.read'],
  },
  'google-drive': {
    connectorId: 'google-drive',
    authorizeUrlEnv: 'MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL',
    clientIdEnv: 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_ID',
    defaultScopes: ['drive.file'],
  },
  gmail: {
    connectorId: 'gmail',
    authorizeUrlEnv: 'MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL',
    clientIdEnv: 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_ID',
    defaultScopes: ['messages.metadata'],
  },
  'google-calendar': {
    connectorId: 'google-calendar',
    authorizeUrlEnv: 'MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL',
    clientIdEnv: 'MEMORY_OS_OAUTH_GOOGLE_CLIENT_ID',
    defaultScopes: ['events.read'],
  },
};

export function vaultRefForAccount(input: {
  env: string;
  connectorId: string;
  accountId: string;
}): string {
  return `vault:${input.env}/connectors/${input.connectorId}/${input.accountId}`;
}

export function resolveOAuthClientId(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const cfg = CONNECTOR_OAUTH_DEFAULTS[connectorId];
  if (!cfg?.clientIdEnv) return null;
  const value = env[cfg.clientIdEnv];
  return value && value.trim() ? value.trim() : null;
}

/**
 * Returns authorize base when real OAuth can start:
 * - explicit MEMORY_OS_OAUTH_*_AUTHORIZE_URL, or
 * - default provider URL when CLIENT_ID is configured.
 * Otherwise null → API/RPC emit stub://oauth/...
 */
export function resolveAuthorizeBase(
  connectorId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const cfg = CONNECTOR_OAUTH_DEFAULTS[connectorId];
  if (!cfg) return null;
  const explicit = cfg.authorizeUrlEnv
    ? env[cfg.authorizeUrlEnv]?.trim() || null
    : null;
  const clientId = resolveOAuthClientId(connectorId, env);
  const base =
    explicit ?? (clientId ? DEFAULT_AUTHORIZE[connectorId] ?? null : null);
  if (!base) return null;
  if (!clientId) return base;
  if (/[?&]client_id=/.test(base)) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}client_id=${encodeURIComponent(clientId)}`;
}

export type OAuthProviderConfig = {
  connectorId: string;
  authorizeBase?: string | null;
  defaultScopes: string[];
};

export const CONNECTOR_OAUTH_DEFAULTS: Record<string, OAuthProviderConfig> = {
  github: {
    connectorId: 'github',
    authorizeBase: process.env.MEMORY_OS_OAUTH_GITHUB_AUTHORIZE_URL ?? null,
    defaultScopes: ['repositories.read', 'pull_requests.read'],
  },
  'google-drive': {
    connectorId: 'google-drive',
    authorizeBase: process.env.MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL ?? null,
    defaultScopes: ['drive.file'],
  },
  gmail: {
    connectorId: 'gmail',
    authorizeBase: process.env.MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL ?? null,
    defaultScopes: ['messages.metadata'],
  },
  'google-calendar': {
    connectorId: 'google-calendar',
    authorizeBase: process.env.MEMORY_OS_OAUTH_GOOGLE_AUTHORIZE_URL ?? null,
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

export function resolveAuthorizeBase(connectorId: string): string | null {
  return CONNECTOR_OAUTH_DEFAULTS[connectorId]?.authorizeBase ?? null;
}

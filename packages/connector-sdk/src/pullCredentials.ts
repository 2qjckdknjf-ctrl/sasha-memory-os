import { resolveConnectorPullMode, type ConnectorPullMode } from './pullMode.js';
import { refreshOAuthAccessToken } from './tokenExchange.js';
import type { VaultStore } from './vault.js';
import { createVaultStore } from './vaultFactory.js';

export type ResolvedPullCredentials =
  | { mode: 'stub'; reason: string }
  | { mode: 'vault'; accessToken: string; vaultRef: string };

function isExpired(expiresAt: string | null | undefined, skewMs = 60_000): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts <= Date.now() + skewMs;
}

/**
 * Resolve whether a connector pull should use stub data or a vault access token.
 * Never returns token material when mode is stub.
 * Refreshes expired tokens when refresh_token + client secrets are available.
 */
export async function resolvePullCredentials(input: {
  vaultRef: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  pullMode?: ConnectorPullMode;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedPullCredentials> {
  const processEnv = input.processEnv ?? process.env;
  const mode = input.pullMode ?? resolveConnectorPullMode(processEnv);
  if (mode === 'stub') {
    return { mode: 'stub', reason: 'MEMORY_OS_CONNECTOR_PULL_MODE=stub' };
  }

  const vault =
    input.vault ??
    createVaultStore({
      env: {
        ...processEnv,
        MEMORY_OS_VAULT_BACKEND:
          processEnv.MEMORY_OS_VAULT_BACKEND?.trim() || 'local',
      },
    });
  let record = await vault.get(input.vaultRef);
  if (!record?.accessToken) {
    if (mode === 'vault') {
      throw new Error(`vault token missing for ${input.vaultRef}`);
    }
    const strict =
      (processEnv.MEMORY_OS_CONNECTOR_PULL_STRICT ?? '').trim() === '1' ||
      (processEnv.MEMORY_OS_CONNECTOR_PULL_STRICT ?? '').trim().toLowerCase() ===
        'true';
    if (strict) {
      throw new Error(
        `vault token missing for ${input.vaultRef} (MEMORY_OS_CONNECTOR_PULL_STRICT=1)`,
      );
    }
    return { mode: 'stub', reason: 'vault token missing; auto fallback to stub' };
  }

  if (isExpired(record.expiresAt)) {
    if (!record.refreshToken) {
      throw new Error(
        `vault token expired for ${input.vaultRef} and no refresh_token`,
      );
    }
    const refreshed = await refreshOAuthAccessToken({
      connectorId: record.provider,
      refreshToken: record.refreshToken,
      env: processEnv,
      fetchImpl: input.fetchImpl,
    });
    record = {
      ...record,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? record.refreshToken,
      tokenType: refreshed.tokenType ?? record.tokenType,
      expiresAt: refreshed.expiresAt ?? record.expiresAt,
      scope: refreshed.scope ?? record.scope,
      storedAt: new Date().toISOString(),
    };
    await vault.put(record);
  }

  return {
    mode: 'vault',
    accessToken: record.accessToken,
    vaultRef: input.vaultRef,
  };
}

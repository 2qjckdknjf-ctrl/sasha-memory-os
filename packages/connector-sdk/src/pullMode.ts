export type ConnectorPullMode = 'stub' | 'vault' | 'auto';

/**
 * stub — always synthetic deltas
 * vault — require vault token; fail if missing
 * auto — use vault token when present, otherwise stub (default)
 */
export function resolveConnectorPullMode(
  env: NodeJS.ProcessEnv = process.env,
): ConnectorPullMode {
  const raw = (env.MEMORY_OS_CONNECTOR_PULL_MODE ?? 'auto').trim().toLowerCase();
  if (raw === 'stub') return 'stub';
  if (raw === 'vault' || raw === 'real') return 'vault';
  return 'auto';
}

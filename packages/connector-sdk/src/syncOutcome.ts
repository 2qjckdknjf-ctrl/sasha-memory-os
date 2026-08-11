import {
  resolveConnectorPullMode,
  type ConnectorPullMode,
} from './pullMode.js';

export type ConnectorSyncJobStatus = 'succeeded' | 'failed';

export type ConnectorSyncOutcome = {
  status: ConnectorSyncJobStatus;
  error: string | null;
};

/**
 * Decide whether a connector_sync job should complete as succeeded or failed.
 * Prevents silent "success" for unsupported connectors or vault-required stub pulls.
 */
export function resolveConnectorSyncOutcome(input: {
  pullMode: string;
  note?: string | null;
  processEnv?: NodeJS.ProcessEnv;
  configuredPullMode?: ConnectorPullMode;
}): ConnectorSyncOutcome {
  const configured =
    input.configuredPullMode ??
    resolveConnectorPullMode(input.processEnv ?? process.env);
  const pullMode = (input.pullMode || 'none').toLowerCase();
  const note = input.note?.trim() || null;

  if (pullMode === 'none') {
    return {
      status: 'failed',
      error: note ?? 'unsupported connector',
    };
  }

  if (configured === 'vault' && pullMode === 'stub') {
    return {
      status: 'failed',
      error:
        note ??
        'MEMORY_OS_CONNECTOR_PULL_MODE=vault but pull used stub (missing vault token)',
    };
  }

  return { status: 'succeeded', error: null };
}

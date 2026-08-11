import { describe, expect, it } from 'vitest';
import { resolveConnectorSyncOutcome } from '@memory-os/connector-sdk';
import { parseWorkerIntervalMs } from './index.js';

describe('connector-sync outcome policy', () => {
  it('marks unsupported connector as failed', () => {
    expect(
      resolveConnectorSyncOutcome({
        pullMode: 'none',
        note: 'unsupported connector',
      }).status,
    ).toBe('failed');
  });

  it('allows auto stub pulls', () => {
    expect(
      resolveConnectorSyncOutcome({
        pullMode: 'stub',
        processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'auto' },
      }).status,
    ).toBe('succeeded');
  });
});

describe('parseWorkerIntervalMs', () => {
  it('returns null when unset', () => {
    expect(parseWorkerIntervalMs({})).toBeNull();
  });

  it('parses valid interval', () => {
    expect(parseWorkerIntervalMs({ MEMORY_OS_WORKER_INTERVAL_MS: '60000' })).toBe(
      60000,
    );
  });
});

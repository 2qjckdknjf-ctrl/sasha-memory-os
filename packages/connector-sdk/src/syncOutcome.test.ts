import { describe, expect, it } from 'vitest';
import { resolveConnectorSyncOutcome } from './syncOutcome.js';

describe('resolveConnectorSyncOutcome', () => {
  it('fails unsupported connectors', () => {
    const outcome = resolveConnectorSyncOutcome({
      pullMode: 'none',
      note: 'unsupported connector',
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'auto' },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('unsupported');
  });

  it('fails stub pulls when vault mode is required', () => {
    const outcome = resolveConnectorSyncOutcome({
      pullMode: 'stub',
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'vault' },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/vault/);
  });

  it('allows stub under auto mode', () => {
    const outcome = resolveConnectorSyncOutcome({
      pullMode: 'stub',
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'auto' },
    });
    expect(outcome).toEqual({ status: 'succeeded', error: null });
  });

  it('succeeds vault pulls', () => {
    const outcome = resolveConnectorSyncOutcome({
      pullMode: 'vault',
      processEnv: { MEMORY_OS_CONNECTOR_PULL_MODE: 'vault' },
    });
    expect(outcome).toEqual({ status: 'succeeded', error: null });
  });
});

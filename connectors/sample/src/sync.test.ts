import { describe, expect, it } from 'vitest';
import { runConnectorCertification, type VaultStore } from '@memory-os/connector-sdk';
import { sampleConnector } from './sync.js';

describe('sampleConnector certification', () => {
  it('passes the full SDK certification kit without secrets', async () => {
    const deletedVaultRefs: string[] = [];
    const vault: VaultStore = {
      async put(_record) {
        return;
      },
      async get(_vaultRef) {
        return null;
      },
      async delete(vaultRef) {
        deletedVaultRefs.push(vaultRef);
      },
    };

    const result = await runConnectorCertification({
      connector: sampleConnector,
      context: {
        account: {
          connectionId: '88888888-8888-4888-8888-888888888899',
          connectorId: 'sample',
          displayName: 'Sample fixture',
          vaultRef: 'vault:test/sample',
          metadata: {},
        },
        workspaceId: '11111111-1111-4111-8111-111111111111',
        vault,
      },
    });

    expect(result.initialRun.records).toHaveLength(2);
    expect(result.initialRun.page.rawObjects).toHaveLength(3);
    expect(result.incrementalRun?.records).toHaveLength(1);
    expect(result.replayRun?.records.map((record) => record.capture.idempotencyKey)).toEqual(
      result.initialRun.records.map((record) => record.capture.idempotencyKey),
    );
    expect(result.resyncRun?.page.mode).toBe('initial');
    expect(result.cursorRecoveryRun?.page.mode).toBe('initial');
    expect(result.rateLimitError?.kind).toBe('rate_limit');
    expect(result.rateLimitError?.retryAfterMs).toBe(120_000);
    expect(result.healthcheck?.status).toBe('healthy');
    expect(result.revoked).toBe(true);
    expect(deletedVaultRefs).toContain('vault:test/sample');
  });
});

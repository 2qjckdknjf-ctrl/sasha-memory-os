import { describe, expect, it } from 'vitest';
import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  runConnectorCertificationSmoke,
  type RegisteredConnector,
} from './index.js';

type SampleRawObject = {
  id: string;
  title: string;
  observedAt: string;
};

const sampleConnector: RegisteredConnector<SampleRawObject> = {
  manifest: {
    id: 'sample',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: 'sample:records',
    auth: 'none',
    capabilities: ['fixtures.read'],
    supports: {
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      webhooks: false,
      live_fetch: false,
      write: false,
      discover: false,
    },
    storage_modes: ['reference'],
    rate_limit_strategy: 'none',
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync() {
      return {
        stream: 'sample:records',
        mode: 'initial',
        rawObjects: [
          { id: 'sample-2', title: 'Second fixture record', observedAt: '2026-08-19T15:00:00.000Z' },
          { id: 'sample-1', title: 'First fixture record', observedAt: '2026-08-19T14:00:00.000Z' },
        ],
        pullMode: 'stub',
        note: 'fixture sample sync',
      };
    },
    async incrementalSync(context) {
      const lastSeen =
        typeof context.cursor?.opaque.lastSeenExternalId === 'string'
          ? context.cursor.opaque.lastSeenExternalId
          : null;
      return {
        stream: 'sample:records',
        mode: 'incremental',
        rawObjects:
          lastSeen === 'sample-2'
            ? []
            : [{ id: 'sample-2', title: 'Second fixture record', observedAt: '2026-08-19T15:00:00.000Z' }],
        pullMode: 'stub',
        note: 'fixture sample incremental sync',
      };
    },
    async normalize(context) {
      return {
        externalObject: {
          provider: 'sample',
          accountId: context.account.connectionId,
          externalId: context.rawObject.id,
          externalVersion: context.rawObject.observedAt,
          objectType: 'fixture_record',
          title: context.rawObject.title,
          createdAt: context.rawObject.observedAt,
          modifiedAt: context.rawObject.observedAt,
          deleted: false,
          attachments: [],
          permissionsSnapshot: {},
          metadata: { fixture: true },
        },
        envelope: {
          schema_version: '1.0',
          workspace_id: context.workspaceId,
          source: {
            provider: 'sample',
            account_id: context.account.connectionId,
            external_id: context.rawObject.id,
            external_version: context.rawObject.observedAt,
          },
          event_type: 'sample.fixture_record',
          observed_at: context.rawObject.observedAt,
          idempotency_key: `connector-sync/${context.account.connectionId}/${context.rawObject.id}`,
          content: {
            mime_type: 'text/plain',
            text: context.rawObject.title,
          },
          scope: {
            sensitivity: 'internal',
            storage_mode: 'reference',
          },
          provenance: { fixture: true },
        },
        capture: {
          title: context.rawObject.title,
          text: `Fixture sample record ${context.rawObject.id}`,
          filename: `sample://${context.rawObject.id}`,
          mimeType: 'text/plain',
          idempotencyKey: `connector-sync/${context.account.connectionId}/${context.rawObject.id}`,
        },
      };
    },
    async checkpoint({ page }) {
      const head = page.rawObjects[0];
      if (!head) return null;
      return buildDefaultCursor('sample:records', {
        lastSeenExternalId: head.id,
        lastSeenObservedAt: head.observedAt,
      });
    },
    async healthcheck(context) {
      return buildConnectionHealthReport({
        connectionId: context.account.connectionId,
        connectorId: 'sample',
        status: 'healthy',
        note: 'fixture connector is healthy',
        checks: [
          {
            name: 'fixture',
            status: 'pass',
            detail: 'Sample connector healthcheck passed.',
          },
        ],
      });
    },
  },
};

describe('runConnectorCertificationSmoke', () => {
  it('certifies a fixture connector without OAuth secrets', async () => {
    const result = await runConnectorCertificationSmoke({
      connector: sampleConnector,
      context: {
        account: {
          connectionId: '88888888-8888-4888-8888-888888888899',
          connectorId: 'sample',
          displayName: 'Sample fixture',
        },
        workspaceId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.capture.idempotencyKey).toContain('connector-sync/');
    expect(result.nextCursor?.stream).toBe('sample:records');
  });
});

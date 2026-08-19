import { describe, expect, it } from 'vitest';
import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  runConnectorCertificationSmoke,
  type RegisteredConnector,
} from './index.js';

type SmokeRawObject = {
  id: string;
  observedAt: string;
};

const smokeConnector: RegisteredConnector<SmokeRawObject> = {
  manifest: {
    id: 'smoke-only',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: 'smoke:records',
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
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync() {
      return {
        stream: 'smoke:records',
        mode: 'initial',
        rawObjects: [{ id: 'record-1', observedAt: '2026-08-19T15:00:00.000Z' }],
        pullMode: 'stub',
      };
    },
    async incrementalSync() {
      return {
        stream: 'smoke:records',
        mode: 'incremental',
        rawObjects: [],
        pullMode: 'stub',
      };
    },
    async normalize(context) {
      return {
        externalObject: {
          provider: 'smoke-only',
          accountId: context.account.connectionId,
          externalId: context.rawObject.id,
          objectType: 'fixture',
          title: context.rawObject.id,
          createdAt: context.rawObject.observedAt,
          modifiedAt: context.rawObject.observedAt,
          deleted: false,
          attachments: [],
          permissionsSnapshot: {},
          metadata: {},
        },
        envelope: {
          schema_version: '1.0',
          workspace_id: context.workspaceId,
          source: {
            provider: 'smoke-only',
            account_id: context.account.connectionId,
            external_id: context.rawObject.id,
          },
          event_type: 'smoke.fixture',
          observed_at: context.rawObject.observedAt,
          idempotency_key: `connector-sync/${context.account.connectionId}/${context.rawObject.id}`,
          content: {
            mime_type: 'text/plain',
            text: context.rawObject.id,
          },
          scope: {
            sensitivity: 'internal',
            storage_mode: 'reference',
          },
          provenance: {
            fixture: true,
          },
        },
        capture: {
          title: context.rawObject.id,
          text: context.rawObject.id,
          filename: `smoke://${context.rawObject.id}`,
          mimeType: 'text/plain',
          idempotencyKey: `connector-sync/${context.account.connectionId}/${context.rawObject.id}`,
        },
      };
    },
    async checkpoint({ page }) {
      const head = page.rawObjects[0];
      if (!head) return null;
      return buildDefaultCursor('smoke:records', {
        lastSeenExternalId: head.id,
      });
    },
    async healthcheck(context) {
      return buildConnectionHealthReport({
        connectionId: context.account.connectionId,
        connectorId: 'smoke-only',
        status: 'healthy',
        note: 'smoke connector is healthy',
      });
    },
  },
};

describe('runConnectorCertificationSmoke', () => {
  it('keeps the smoke-only entry point working for existing connectors', async () => {
    const result = await runConnectorCertificationSmoke({
      connector: smokeConnector,
      context: {
        account: {
          connectionId: '88888888-8888-4888-8888-888888888899',
          connectorId: 'smoke-only',
          displayName: 'Smoke fixture',
        },
        workspaceId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(result.records).toHaveLength(1);
    expect(result.nextCursor?.stream).toBe('smoke:records');
  });
});

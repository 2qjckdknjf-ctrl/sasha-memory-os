import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  connectorCursorExpiredError,
  connectorPoisonObjectError,
  connectorRateLimitError,
  type ConnectorSyncContext,
  type RegisteredConnector,
} from '@memory-os/connector-sdk';

export const SAMPLE_CURSOR_STREAM = 'sample:records' as const;

type SampleScenario = 'default' | 'rate_limit';

export type SampleRawObject = {
  id: string;
  title: string;
  observedAt: string;
  deleted?: boolean;
  permissions?: Record<string, unknown>;
  poison?: boolean;
};

function resolveSampleScenario(context: ConnectorSyncContext): SampleScenario {
  const scenario = context.account.metadata?.sampleScenario;
  return scenario === 'rate_limit' ? 'rate_limit' : 'default';
}

function buildInitialFixtures(): SampleRawObject[] {
  return [
    {
      id: 'sample-3',
      title: 'Fresh fixture record',
      observedAt: '2026-08-19T15:00:00.000Z',
      permissions: {
        role: 'reader',
        visibility: 'workspace',
      },
    },
    {
      id: 'sample-2',
      title: 'Deleted fixture record',
      observedAt: '2026-08-19T14:30:00.000Z',
      deleted: true,
      permissions: {
        role: 'former-member',
        visibility: 'revoked',
      },
    },
    {
      id: 'sample-poison',
      title: 'Poison fixture record',
      observedAt: '2026-08-19T14:00:00.000Z',
      poison: true,
    },
  ];
}

function buildIncrementalFixtures(lastSeenExternalId: string | null): SampleRawObject[] {
  if (lastSeenExternalId === 'sample-4') {
    return [];
  }
  return [
    {
      id: 'sample-4',
      title: 'Incremental fixture record',
      observedAt: '2026-08-19T16:00:00.000Z',
      permissions: {
        role: 'editor',
        visibility: 'workspace',
      },
    },
  ];
}

function assertNotRateLimited(context: ConnectorSyncContext) {
  if (resolveSampleScenario(context) !== 'rate_limit') return;
  throw connectorRateLimitError({
    message: 'Sample connector received a synthetic 429 response',
    retryAfterMs: 120_000,
  });
}

function resolveCursorExternalId(context: ConnectorSyncContext): string | null {
  return typeof context.cursor?.opaque.lastSeenExternalId === 'string'
    ? context.cursor.opaque.lastSeenExternalId
    : null;
}

function resolveObservedAt(rawObject: SampleRawObject): string {
  return rawObject.observedAt;
}

export const sampleConnector: RegisteredConnector<SampleRawObject> = {
  manifest: {
    id: 'sample',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: SAMPLE_CURSOR_STREAM,
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
    rate_limit_strategy: 'retry_after',
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync(context) {
      assertNotRateLimited(context);
      return {
        stream: SAMPLE_CURSOR_STREAM,
        mode: 'initial',
        rawObjects: buildInitialFixtures(),
        pullMode: 'stub',
        note: 'fixture sample initial sync',
      };
    },
    async incrementalSync(context) {
      assertNotRateLimited(context);
      if (context.cursor?.opaque.cursorState === 'expired') {
        throw connectorCursorExpiredError({
          message: 'Sample connector cursor expired',
        });
      }
      return {
        stream: SAMPLE_CURSOR_STREAM,
        mode: 'incremental',
        rawObjects: buildIncrementalFixtures(resolveCursorExternalId(context)),
        pullMode: 'stub',
        note: 'fixture sample incremental sync',
      };
    },
    async normalize(context) {
      if (context.rawObject.poison) {
        throw connectorPoisonObjectError({
          message: `Sample poison fixture ${context.rawObject.id}`,
        });
      }
      return {
        externalObject: {
          provider: 'sample',
          accountId: context.account.connectionId,
          externalId: context.rawObject.id,
          externalVersion: context.rawObject.observedAt,
          objectType: 'fixture_record',
          title: context.rawObject.title,
          createdAt: resolveObservedAt(context.rawObject),
          modifiedAt: resolveObservedAt(context.rawObject),
          deleted: context.rawObject.deleted ?? false,
          attachments: [],
          permissionsSnapshot: context.rawObject.permissions ?? {},
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
          provenance: {
            fixture: true,
            provider: 'sample',
            connectorVersion: '1.0.0',
          },
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
    async checkpoint({ records, page, previousCursor }) {
      const newestRecord = records[0];
      if (!newestRecord) {
        return previousCursor ?? page.nextCursor ?? null;
      }
      const newestRawObject = page.rawObjects.find(
        (rawObject) => rawObject.id === newestRecord.externalObject.externalId,
      );
      if (!newestRawObject) return previousCursor ?? null;
      return buildDefaultCursor(SAMPLE_CURSOR_STREAM, {
        lastSeenExternalId: newestRawObject.id,
        lastSeenObservedAt: newestRawObject.observedAt,
      });
    },
    async healthcheck(context) {
      return buildConnectionHealthReport({
        connectionId: context.account.connectionId,
        connectorId: 'sample',
        status: 'healthy',
        note: 'Fixture connector is healthy.',
        checks: [
          {
            name: 'fixture',
            status: 'pass',
            detail: 'Sample connector healthcheck passed.',
          },
        ],
      });
    },
    async revoke(context) {
      if (context.vault && context.account.vaultRef) {
        await context.vault.delete(context.account.vaultRef);
      }
    },
  },
  certification: {
    expectPoisonIsolation: true,
    buildReplayContext({ baseContext }) {
      return {
        ...baseContext,
        cursor: null,
      };
    },
    buildResyncContext({ baseContext }) {
      return {
        ...baseContext,
        cursor: null,
      };
    },
    buildCursorExpiredContext({ baseContext }) {
      return {
        ...baseContext,
        cursor: buildDefaultCursor(SAMPLE_CURSOR_STREAM, {
          lastSeenExternalId: 'sample-3',
          lastSeenObservedAt: '2026-08-19T15:00:00.000Z',
          cursorState: 'expired',
        }),
      };
    },
    buildRateLimitContext({ baseContext }) {
      return {
        ...baseContext,
        account: {
          ...baseContext.account,
          metadata: {
            ...baseContext.account.metadata,
            sampleScenario: 'rate_limit',
          },
        },
      };
    },
    buildRevokeContext(context) {
      return {
        ...context,
        account: {
          ...context.account,
          vaultRef: context.account.vaultRef ?? 'vault:test/sample',
        },
      };
    },
    assertDeletionPropagation(run) {
      return run.records.some((record) => record.externalObject.deleted);
    },
    assertPermissionChangePropagation(run) {
      return run.records.some(
        (record) => record.externalObject.permissionsSnapshot.role === 'reader',
      );
    },
  },
};

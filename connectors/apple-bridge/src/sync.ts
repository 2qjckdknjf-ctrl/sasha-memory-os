import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  connectorCursorExpiredError,
  connectorPoisonObjectError,
  connectorRateLimitError,
  type ConnectorNormalizeContext,
  type ConnectorSyncContext,
  type NormalizedConnectorRecord,
  type RegisteredConnector,
} from '@memory-os/connector-sdk';
import type { AppleCompanionIngestRequest } from '@memory-os/schemas';

export const APPLE_BRIDGE_CURSOR_STREAM = 'apple:device-items' as const;

type AppleBridgeScenario = 'default' | 'rate_limit';

export type AppleBridgeRawObject = AppleCompanionIngestRequest & {
  deleted?: boolean;
  permissions?: Record<string, unknown>;
  poison?: boolean;
};

function resolveAppleBridgeScenario(context: ConnectorSyncContext): AppleBridgeScenario {
  const scenario = context.account.metadata?.appleScenario;
  return scenario === 'rate_limit' ? 'rate_limit' : 'default';
}

function assertNotRateLimited(context: ConnectorSyncContext) {
  if (resolveAppleBridgeScenario(context) !== 'rate_limit') return;
  throw connectorRateLimitError({
    message: 'Apple bridge is retrying after a synthetic device backpressure response',
    retryAfterMs: 90_000,
  });
}

function isUuid(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function resolveObservedAt(rawObject: AppleBridgeRawObject): string {
  return rawObject.observed_at ?? new Date().toISOString();
}

function resolveMimeType(rawObject: AppleBridgeRawObject): string {
  if (rawObject.mime_type) return rawObject.mime_type;
  switch (rawObject.kind) {
    case 'text':
      return 'text/plain';
    case 'url':
      return 'text/uri-list';
    case 'photo':
      return 'image/jpeg';
    case 'file':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

function resolveExternalId(rawObject: AppleBridgeRawObject): string {
  return (
    rawObject.identifiers.local_identifier ??
    rawObject.identifiers.cloud_identifier ??
    rawObject.identifiers.provider_item_identifier ??
    rawObject.url ??
    rawObject.filename ??
    rawObject.item_id
  );
}

function resolveCanonicalReference(rawObject: AppleBridgeRawObject): string | undefined {
  if (rawObject.url) return rawObject.url;
  const externalId = resolveExternalId(rawObject);
  if (!externalId) return undefined;
  return `apple://${rawObject.kind}/${encodeURIComponent(externalId)}`;
}

function resolveCaptureText(rawObject: AppleBridgeRawObject): string {
  if (rawObject.kind === 'text') {
    return rawObject.text ?? rawObject.title;
  }
  const lines = [
    `Apple ${rawObject.kind} item`,
    `Title: ${rawObject.title}`,
    rawObject.filename ? `Filename: ${rawObject.filename}` : null,
    rawObject.url ? `URL: ${rawObject.url}` : null,
    rawObject.identifiers.local_identifier
      ? `Local identifier: ${rawObject.identifiers.local_identifier}`
      : null,
    rawObject.identifiers.cloud_identifier
      ? `Cloud identifier: ${rawObject.identifiers.cloud_identifier}`
      : null,
    rawObject.identifiers.provider_item_identifier
      ? `Provider item identifier: ${rawObject.identifiers.provider_item_identifier}`
      : null,
  ];
  return lines.filter((line): line is string => typeof line === 'string').join('\n');
}

function resolveCaptureFilename(rawObject: AppleBridgeRawObject): string {
  if (rawObject.filename) return rawObject.filename;
  if (rawObject.url) return rawObject.url;
  return `apple://${rawObject.kind}/${resolveExternalId(rawObject)}`;
}

function resolveProjectId(rawObject: AppleBridgeRawObject): string | undefined {
  return isUuid(rawObject.project_id) ? rawObject.project_id : undefined;
}

function buildAppleBridgeIdempotencyKey(
  accountId: string,
  rawObject: AppleBridgeRawObject,
): string {
  return rawObject.idempotency_key || `apple-bridge/${accountId}/${resolveExternalId(rawObject)}`;
}

export function buildAppleBridgeRecord(input: {
  workspaceId: string;
  accountId: string;
  rawObject: AppleBridgeRawObject;
}): NormalizedConnectorRecord {
  const observedAt = resolveObservedAt(input.rawObject);
  const mimeType = resolveMimeType(input.rawObject);
  const externalId = resolveExternalId(input.rawObject);
  const idempotencyKey = buildAppleBridgeIdempotencyKey(input.accountId, input.rawObject);
  const captureText = resolveCaptureText(input.rawObject);
  const canonicalReference = resolveCanonicalReference(input.rawObject);
  return {
    externalObject: {
      provider: 'apple',
      accountId: input.accountId,
      externalId,
      externalVersion: input.rawObject.external_version ?? observedAt,
      objectType: input.rawObject.kind,
      title: input.rawObject.title,
      contentReference: canonicalReference,
      createdAt: observedAt,
      modifiedAt: observedAt,
      deleted: input.rawObject.deleted ?? false,
      attachments: [],
      permissionsSnapshot: input.rawObject.permissions ?? {},
      metadata: {
        source: input.rawObject.source,
        deviceId: input.rawObject.device_id,
        connectionId: input.rawObject.connection_id ?? null,
        identifiers: input.rawObject.identifiers,
        itemId: input.rawObject.item_id,
        deleteLocalAfterAck: input.rawObject.delete_local_after_ack,
        ...input.rawObject.metadata,
      },
      canonicalReference,
    },
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'apple',
        account_id: input.accountId,
        external_id: externalId,
        external_version: input.rawObject.external_version ?? observedAt,
      },
      event_type: `apple.${input.rawObject.kind}.captured`,
      observed_at: observedAt,
      idempotency_key: idempotencyKey,
      content: {
        mime_type: mimeType,
        text: captureText,
        reference: canonicalReference,
      },
      scope: {
        project_id: resolveProjectId(input.rawObject),
        sensitivity: input.rawObject.sensitivity,
        storage_mode: input.rawObject.storage_mode,
      },
      provenance: {
        provider: 'apple',
        device_id: input.rawObject.device_id,
        source: input.rawObject.source,
        local_identifier: input.rawObject.identifiers.local_identifier ?? null,
        cloud_identifier: input.rawObject.identifiers.cloud_identifier ?? null,
        provider_item_identifier: input.rawObject.identifiers.provider_item_identifier ?? null,
        canonical_reference: canonicalReference ?? null,
        delete_local_after_ack: input.rawObject.delete_local_after_ack,
      },
    },
    capture: {
      title: input.rawObject.title,
      text: captureText,
      filename: resolveCaptureFilename(input.rawObject),
      mimeType,
      idempotencyKey,
    },
  };
}

export async function normalizeAppleBridgeRawObject(
  context: ConnectorNormalizeContext<AppleBridgeRawObject>,
): Promise<NormalizedConnectorRecord> {
  if (context.rawObject.poison) {
    throw connectorPoisonObjectError({
      message: `Apple bridge rejected poison item ${context.rawObject.item_id}`,
    });
  }
  return buildAppleBridgeRecord({
    workspaceId: context.workspaceId,
    accountId: context.account.connectionId,
    rawObject: context.rawObject,
  });
}

function buildInitialFixtures(): AppleBridgeRawObject[] {
  return [
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      device_id: 'fixture-iphone',
      connection_id: '88888888-8888-4888-8888-888888888899',
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      kind: 'text',
      title: 'Apple companion note',
      text: 'Remember the selected sprint whiteboard.',
      observed_at: '2026-08-19T21:00:00.000Z',
      storage_mode: 'indexed',
      sensitivity: 'internal',
      idempotency_key: 'apple-share/fixture-iphone/note-1',
      delete_local_after_ack: true,
      process_now: false,
      source: 'companion_app',
      identifiers: {
        local_identifier: 'APPLE-NOTE-1',
      },
      metadata: {
        origin: 'fixture',
      },
      permissions: {
        photo_library: 'limited',
      },
    },
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      device_id: 'fixture-iphone',
      connection_id: '88888888-8888-4888-8888-888888888899',
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      kind: 'photo',
      title: 'Deleted asset tombstone',
      filename: 'IMG_1002.HEIC',
      mime_type: 'image/heic',
      observed_at: '2026-08-19T20:30:00.000Z',
      storage_mode: 'reference',
      sensitivity: 'personal',
      idempotency_key: 'apple-share/fixture-iphone/photo-2',
      delete_local_after_ack: false,
      process_now: false,
      source: 'photo_library',
      identifiers: {
        local_identifier: 'PHOTO-LOCAL-2',
        cloud_identifier: 'PHOTO-CLOUD-2',
      },
      metadata: {
        album: 'Camera Roll',
      },
      deleted: true,
      permissions: {
        photo_library: 'limited',
      },
    },
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      device_id: 'fixture-iphone',
      connection_id: '88888888-8888-4888-8888-888888888899',
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      kind: 'file',
      title: 'Poison item',
      filename: 'bad.txt',
      observed_at: '2026-08-19T20:00:00.000Z',
      storage_mode: 'reference',
      sensitivity: 'internal',
      idempotency_key: 'apple-share/fixture-iphone/poison-3',
      delete_local_after_ack: true,
      process_now: false,
      source: 'share_extension',
      identifiers: {
        provider_item_identifier: 'FILE-POISON-3',
      },
      metadata: {},
      poison: true,
    },
  ];
}

function buildIncrementalFixtures(lastSeenExternalId: string | null): AppleBridgeRawObject[] {
  if (lastSeenExternalId === 'https://example.com/apple-note-4') {
    return [];
  }
  return [
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      device_id: 'fixture-mac',
      connection_id: '88888888-8888-4888-8888-888888888899',
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      kind: 'url',
      title: 'Apple shared URL',
      url: 'https://example.com/apple-note-4',
      observed_at: '2026-08-19T22:00:00.000Z',
      storage_mode: 'reference',
      sensitivity: 'internal',
      idempotency_key: 'apple-share/fixture-mac/url-4',
      delete_local_after_ack: true,
      process_now: false,
      source: 'share_extension',
      identifiers: {
        provider_item_identifier: 'URL-4',
      },
      metadata: {
        browser: 'Safari',
      },
      permissions: {
        files: 'full',
      },
    },
  ];
}

function resolveCursorExternalId(context: ConnectorSyncContext): string | null {
  return typeof context.cursor?.opaque.lastSeenExternalId === 'string'
    ? context.cursor.opaque.lastSeenExternalId
    : null;
}

export const appleBridgeConnector: RegisteredConnector<AppleBridgeRawObject> = {
  manifest: {
    id: 'apple',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: APPLE_BRIDGE_CURSOR_STREAM,
    auth: 'device',
    capabilities: [
      'device.push',
      'share_extension',
      'photos.selected.read',
      'files.selected.read',
    ],
    supports: {
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      webhooks: false,
      live_fetch: false,
      write: false,
      discover: false,
    },
    storage_modes: ['reference', 'indexed', 'archived'],
    rate_limit_strategy: 'device_checkpoint',
    data_classes: ['internal', 'personal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync(context) {
      assertNotRateLimited(context);
      return {
        stream: APPLE_BRIDGE_CURSOR_STREAM,
        mode: 'initial',
        rawObjects: buildInitialFixtures(),
        pullMode: 'device_checkpoint',
        note: 'fixture Apple device checkpoint',
      };
    },
    async incrementalSync(context) {
      assertNotRateLimited(context);
      if (context.cursor?.opaque.cursorState === 'expired') {
        throw connectorCursorExpiredError({
          message: 'Apple bridge device checkpoint expired',
        });
      }
      return {
        stream: APPLE_BRIDGE_CURSOR_STREAM,
        mode: 'incremental',
        rawObjects: buildIncrementalFixtures(resolveCursorExternalId(context)),
        pullMode: 'device_checkpoint',
        note: 'fixture Apple incremental checkpoint',
      };
    },
    normalize: normalizeAppleBridgeRawObject,
    async checkpoint({ records, page, previousCursor }) {
      const newestRecord = records[0];
      if (!newestRecord) {
        return previousCursor ?? page.nextCursor ?? null;
      }
      const newestRawObject = page.rawObjects.find(
        (rawObject) => resolveExternalId(rawObject) === newestRecord.externalObject.externalId,
      );
      if (!newestRawObject) return previousCursor ?? null;
      return buildDefaultCursor(APPLE_BRIDGE_CURSOR_STREAM, {
        lastSeenExternalId: resolveExternalId(newestRawObject),
        lastSeenObservedAt: resolveObservedAt(newestRawObject),
      });
    },
    async healthcheck(context) {
      return buildConnectionHealthReport({
        connectionId: context.account.connectionId,
        connectorId: 'apple',
        status: 'healthy',
        note: 'Apple bridge is ready for user-mediated device uploads.',
        checks: [
          {
            name: 'device_push_contract',
            status: 'pass',
            detail: 'Apple bridge accepted the device-push contract.',
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
        cursor: buildDefaultCursor(APPLE_BRIDGE_CURSOR_STREAM, {
          lastSeenExternalId: 'APPLE-NOTE-1',
          lastSeenObservedAt: '2026-08-19T21:00:00.000Z',
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
            appleScenario: 'rate_limit',
          },
        },
      };
    },
    buildRevokeContext(context) {
      return {
        ...context,
        account: {
          ...context.account,
          vaultRef: context.account.vaultRef ?? 'vault:test/apple',
        },
      };
    },
    assertDeletionPropagation(run) {
      return run.records.some((record) => record.externalObject.deleted);
    },
    assertPermissionChangePropagation(run) {
      return run.records.some(
        (record) => record.externalObject.permissionsSnapshot.photo_library === 'limited',
      );
    },
  },
};

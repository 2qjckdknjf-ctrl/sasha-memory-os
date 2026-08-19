import {
  connectorCollectionSchema,
  ingestionEnvelopeSchema,
  storageModeSchema,
  type ConnectorCollection,
  type IngestionEnvelope,
} from '@memory-os/schemas';
import { z } from 'zod';
import type { VaultStore } from './vault.js';

export const connectorSupportsSchema = z.object({
  discover: z.boolean().default(false),
  validate_scope: z.boolean().default(false),
  initial_sync: z.boolean().default(false),
  incremental_sync: z.boolean().default(false),
  live_fetch: z.boolean().default(false),
  webhooks: z.boolean().default(false),
  write: z.boolean().default(false),
});

const DEFAULT_CONNECTOR_SUPPORTS = {
  discover: false,
  validate_scope: false,
  initial_sync: false,
  incremental_sync: false,
  live_fetch: false,
  webhooks: false,
  write: false,
} as const;

export const connectorManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  sdk_version: z.string().min(1).default('1.0'),
  default_stream: z.string().min(1).optional(),
  auth: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  supports: connectorSupportsSchema.default(DEFAULT_CONNECTOR_SUPPORTS),
  storage_modes: z.array(storageModeSchema).default(['reference']),
  rate_limit_strategy: z.string().min(1).optional(),
  data_classes: z.array(z.string()).default(['internal']),
});

export type ConnectorManifest = z.infer<typeof connectorManifestSchema>;

const externalAuthorSchema = z.object({
  externalId: z.string().min(1),
  displayName: z.string().min(1).optional(),
});

export const externalObjectSchema = z.object({
  provider: z.string().min(1),
  accountId: z.string().min(1),
  collectionId: z.string().min(1).optional(),
  externalId: z.string().min(1),
  externalVersion: z.string().min(1).optional(),
  objectType: z.string().min(1),
  title: z.string().min(1),
  contentReference: z.string().min(1).optional(),
  author: externalAuthorSchema.optional(),
  createdAt: z.string().datetime().optional(),
  modifiedAt: z.string().datetime().optional(),
  deleted: z.boolean().default(false),
  attachments: z.array(z.record(z.string(), z.unknown())).default([]),
  permissionsSnapshot: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  canonicalReference: z.string().min(1).optional(),
});

export type ExternalObject = z.infer<typeof externalObjectSchema>;

export const syncCursorSchema = z.object({
  stream: z.string().min(1),
  opaque: z.record(z.string(), z.unknown()).default({}),
  schemaVersion: z.string().min(1).default('1.0'),
  updatedAt: z.string().datetime().optional(),
});

export type SyncCursor = z.infer<typeof syncCursorSchema>;

export const connectorCaptureSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1).default('text/plain'),
  idempotencyKey: z.string().min(1),
});

export type ConnectorCapture = z.infer<typeof connectorCaptureSchema>;

export const normalizedConnectorRecordSchema = z.object({
  externalObject: externalObjectSchema,
  envelope: ingestionEnvelopeSchema,
  capture: connectorCaptureSchema,
});

export type NormalizedConnectorRecord = z.infer<typeof normalizedConnectorRecordSchema>;

export const connectorDiscoverResultSchema = z.object({
  collections: z.array(connectorCollectionSchema).default([]),
  note: z.string().optional(),
});

export type ConnectorDiscoverResult = z.infer<typeof connectorDiscoverResultSchema>;

export type ConnectorAccount = {
  connectionId: string;
  connectorId: string;
  displayName?: string;
  vaultRef?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
};

export type ConnectorSyncContext = {
  account: ConnectorAccount;
  workspaceId: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  cursor?: SyncCursor | null;
};

export type ConnectorNormalizeContext<TRaw> = ConnectorSyncContext & {
  rawObject: TRaw;
};

export type ConnectorSyncPage<TRaw> = {
  stream: string;
  mode: 'initial' | 'incremental';
  rawObjects: TRaw[];
  nextCursor?: SyncCursor | null;
  pullMode?: string;
  note?: string;
};

const healthCheckSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['pass', 'warn', 'fail']),
  detail: z.string().min(1),
});

export const connectionHealthReportSchema = z.object({
  connectionId: z.string().min(1),
  connectorId: z.string().min(1),
  status: z.enum(['healthy', 'degraded', 'reauth_required', 'revoked', 'disabled']),
  note: z.string().min(1),
  vaultRef: z.string().min(1).optional(),
  checkedAt: z.string().datetime(),
  checks: z.array(healthCheckSchema).default([]),
});

export type ConnectionHealthReport = z.infer<typeof connectionHealthReportSchema>;

export type ConnectorCheckpointInput<TRaw> = {
  context: ConnectorSyncContext;
  page: ConnectorSyncPage<TRaw>;
  records: NormalizedConnectorRecord[];
  previousCursor: SyncCursor | null;
};

export type ConnectorLifecycle<TRaw = unknown> = {
  discover?: (context: ConnectorSyncContext) => Promise<ConnectorDiscoverResult>;
  validateScope?: (context: ConnectorSyncContext) => Promise<{ ok: boolean; missing?: string[] }>;
  initialSync?: (context: ConnectorSyncContext) => Promise<ConnectorSyncPage<TRaw>>;
  incrementalSync?: (context: ConnectorSyncContext) => Promise<ConnectorSyncPage<TRaw>>;
  normalize: (context: ConnectorNormalizeContext<TRaw>) => Promise<NormalizedConnectorRecord>;
  checkpoint?: (input: ConnectorCheckpointInput<TRaw>) => Promise<SyncCursor | null>;
  healthcheck?: (context: ConnectorSyncContext) => Promise<ConnectionHealthReport>;
  revoke?: (context: ConnectorSyncContext) => Promise<void>;
};

export type RegisteredConnector<TRaw = unknown> = {
  manifest: ConnectorManifest;
  lifecycle: ConnectorLifecycle<TRaw>;
};

export type ConnectorSyncRun<TRaw = unknown> = {
  manifest: ConnectorManifest;
  page: ConnectorSyncPage<TRaw>;
  records: NormalizedConnectorRecord[];
  nextCursor: SyncCursor | null;
};

export function parseConnectorManifest(manifest: ConnectorManifest): ConnectorManifest {
  return connectorManifestSchema.parse(manifest);
}

export function parseExternalObject(object: ExternalObject): ExternalObject {
  return externalObjectSchema.parse(object);
}

export function parseSyncCursor(cursor: SyncCursor | null | undefined): SyncCursor | null {
  if (!cursor) return null;
  return syncCursorSchema.parse(cursor);
}

export function parseNormalizedConnectorRecord(
  record: NormalizedConnectorRecord,
): NormalizedConnectorRecord {
  return normalizedConnectorRecordSchema.parse(record);
}

export function parseConnectorDiscoverResult(
  result: ConnectorDiscoverResult,
): ConnectorDiscoverResult {
  return connectorDiscoverResultSchema.parse(result);
}

export function parseConnectionHealthReport(
  report: ConnectionHealthReport,
): ConnectionHealthReport {
  return connectionHealthReportSchema.parse(report);
}

export type { ConnectorCollection, IngestionEnvelope };

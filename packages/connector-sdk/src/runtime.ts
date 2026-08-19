import {
  parseConnectionHealthReport,
  parseConnectorDiscoverResult,
  parseConnectorManifest,
  parseNormalizedConnectorRecord,
  parseSyncCursor,
  type ConnectionHealthReport,
  type ConnectorDiscoverResult,
  type ConnectorSyncContext,
  type ConnectorSyncRun,
  type RegisteredConnector,
  type SyncCursor,
} from './contract.js';
import { classifyConnectorError } from './errors.js';

export async function runConnectorSync<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectorSyncRun<TRaw>> {
  const manifest = parseConnectorManifest(input.connector.manifest);
  const previousCursor = parseSyncCursor(input.context.cursor);
  const canIncremental =
    previousCursor !== null &&
    manifest.supports.incremental_sync &&
    typeof input.connector.lifecycle.incrementalSync === 'function';

  let page;
  let effectivePreviousCursor = previousCursor;
  if (canIncremental) {
    try {
      page = await input.connector.lifecycle.incrementalSync!(input.context);
    } catch (error) {
      const classified = classifyConnectorError(error);
      if (classified.kind !== 'cursor_expired') {
        throw error;
      }
      effectivePreviousCursor = null;
      page = await resolveInitialPage(input.connector, {
        ...input.context,
        cursor: null,
      });
    }
  } else {
    page = await resolveInitialPage(input.connector, input.context);
  }

  const records = [];
  for (const rawObject of page.rawObjects) {
    try {
      records.push(
        await input.connector.lifecycle.normalize({
          ...input.context,
          rawObject,
          cursor: effectivePreviousCursor,
        }),
      );
    } catch (error) {
      const classified = classifyConnectorError(error);
      if (classified.kind !== 'poison_object') {
        throw error;
      }
    }
  }

  for (const record of records) {
    parseNormalizedConnectorRecord(record);
  }

  const nextCursor = input.connector.lifecycle.checkpoint
    ? await input.connector.lifecycle.checkpoint({
        context: input.context,
        page,
        records,
        previousCursor: effectivePreviousCursor,
      })
    : page.nextCursor ?? effectivePreviousCursor;

  return {
    manifest,
    page,
    records,
    nextCursor: parseSyncCursor(nextCursor),
  };
}

async function resolveInitialPage<TRaw>(
  connector: RegisteredConnector<TRaw>,
  context: ConnectorSyncContext,
) {
  if (typeof connector.lifecycle.initialSync === 'function') {
    return connector.lifecycle.initialSync(context);
  }
  if (typeof connector.lifecycle.incrementalSync === 'function') {
    return connector.lifecycle.incrementalSync({ ...context, cursor: null });
  }
  throw new Error(`connector ${connector.manifest.id} does not implement a sync lifecycle`);
}

export async function runConnectorHealthcheck<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectionHealthReport | null> {
  if (typeof input.connector.lifecycle.healthcheck !== 'function') return null;
  return parseConnectionHealthReport(await input.connector.lifecycle.healthcheck(input.context));
}

export async function runConnectorDiscover<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectorDiscoverResult | null> {
  if (typeof input.connector.lifecycle.discover !== 'function') return null;
  return parseConnectorDiscoverResult(await input.connector.lifecycle.discover(input.context));
}

export function buildDefaultCursor(
  stream: string,
  opaque: Record<string, unknown>,
  schemaVersion = '1.0',
): SyncCursor {
  return parseSyncCursor({
    stream,
    opaque,
    schemaVersion,
    updatedAt: new Date().toISOString(),
  })!;
}

export function buildConnectionHealthReport(input: {
  connectionId: string;
  connectorId: string;
  status: ConnectionHealthReport['status'];
  note: string;
  vaultRef?: string;
  checks?: ConnectionHealthReport['checks'];
}): ConnectionHealthReport {
  return parseConnectionHealthReport({
    connectionId: input.connectionId,
    connectorId: input.connectorId,
    status: input.status,
    note: input.note,
    vaultRef: input.vaultRef,
    checkedAt: new Date().toISOString(),
    checks: input.checks ?? [],
  });
}

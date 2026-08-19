import {
  parseConnectionHealthReport,
  parseConnectorManifest,
  parseSyncCursor,
  type ConnectorSyncContext,
  type ConnectorSyncRun,
  type RegisteredConnector,
} from './contract.js';
import { runConnectorDiscover, runConnectorHealthcheck, runConnectorSync } from './runtime.js';

export async function runConnectorCertificationSmoke<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectorSyncRun<TRaw>> {
  const manifest = parseConnectorManifest(input.connector.manifest);
  const { lifecycle } = input.connector;

  if (manifest.supports.validate_scope && !lifecycle.validateScope) {
    throw new Error(`connector ${manifest.id} is missing validateScope()`);
  }
  if (manifest.supports.discover && !lifecycle.discover) {
    throw new Error(`connector ${manifest.id} is missing discover()`);
  }
  if (manifest.supports.initial_sync && !lifecycle.initialSync) {
    throw new Error(`connector ${manifest.id} is missing initialSync()`);
  }
  if (manifest.supports.incremental_sync && !lifecycle.incrementalSync) {
    throw new Error(`connector ${manifest.id} is missing incrementalSync()`);
  }
  if (!lifecycle.normalize) {
    throw new Error(`connector ${manifest.id} is missing normalize()`);
  }

  if (lifecycle.validateScope) {
    const validation = await lifecycle.validateScope(input.context);
    if (!validation.ok) {
      throw new Error(
        `connector ${manifest.id} scope validation failed: ${(validation.missing ?? []).join(', ')}`,
      );
    }
  }

  if (lifecycle.discover) {
    await runConnectorDiscover({
      connector: input.connector,
      context: { ...input.context, cursor: null },
    });
  }

  const initialRun = await runConnectorSync({
    connector: input.connector,
    context: { ...input.context, cursor: null },
  });

  if (manifest.supports.incremental_sync) {
    const incrementalRun = await runConnectorSync({
      connector: input.connector,
      context: { ...input.context, cursor: initialRun.nextCursor },
    });
    parseSyncCursor(incrementalRun.nextCursor);
  }

  if (lifecycle.healthcheck) {
    parseConnectionHealthReport(
      (await runConnectorHealthcheck({
        connector: input.connector,
        context: { ...input.context, cursor: null },
      }))!,
    );
  }

  return initialRun;
}

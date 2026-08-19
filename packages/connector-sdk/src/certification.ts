import {
  parseConnectionHealthReport,
  parseConnectorManifest,
  parseSyncCursor,
  type ConnectionHealthReport,
  type ConnectorSyncContext,
  type ConnectorSyncRun,
  type RegisteredConnector,
} from './contract.js';
import { classifyConnectorError, type ClassifiedConnectorError } from './errors.js';
import { runConnectorDiscover, runConnectorHealthcheck, runConnectorSync } from './runtime.js';

export type ConnectorCertificationReport<TRaw> = {
  manifestId: string;
  initialRun: ConnectorSyncRun<TRaw>;
  incrementalRun: ConnectorSyncRun<TRaw> | null;
  replayRun: ConnectorSyncRun<TRaw> | null;
  resyncRun: ConnectorSyncRun<TRaw> | null;
  cursorRecoveryRun: ConnectorSyncRun<TRaw> | null;
  rateLimitError: ClassifiedConnectorError | null;
  healthcheck: ConnectionHealthReport | null;
  revoked: boolean;
};

export async function runConnectorCertification<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectorCertificationReport<TRaw>> {
  const manifest = parseConnectorManifest(input.connector.manifest);
  const { lifecycle } = input.connector;
  const suite = input.connector.certification;

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

  assertRecordProvenance(manifest.id, initialRun);
  if (suite?.expectPoisonIsolation && initialRun.page.rawObjects.length <= initialRun.records.length) {
    throw new Error(`connector ${manifest.id} did not isolate a poison object`);
  }
  if (suite?.assertDeletionPropagation && !suite.assertDeletionPropagation(initialRun)) {
    throw new Error(`connector ${manifest.id} did not surface deletion propagation`);
  }
  if (
    suite?.assertPermissionChangePropagation &&
    !suite.assertPermissionChangePropagation(initialRun)
  ) {
    throw new Error(`connector ${manifest.id} did not surface permission change propagation`);
  }

  let incrementalRun: ConnectorSyncRun<TRaw> | null = null;
  if (manifest.supports.incremental_sync) {
    incrementalRun = await runConnectorSync({
      connector: input.connector,
      context: { ...input.context, cursor: initialRun.nextCursor },
    });
    parseSyncCursor(incrementalRun.nextCursor);
    assertRecordProvenance(manifest.id, incrementalRun);
  }

  const replayContext = suite?.buildReplayContext
    ? await suite.buildReplayContext({
        baseContext: input.context,
        initialRun,
      })
    : null;
  const replayRun = replayContext
    ? await runConnectorSync({
        connector: input.connector,
        context: replayContext,
      })
    : null;
  if (replayRun) {
    assertReplayIdempotency(manifest.id, initialRun, replayRun);
  }

  const resyncContext = suite?.buildResyncContext
    ? await suite.buildResyncContext({
        baseContext: input.context,
        initialRun,
      })
    : null;
  const resyncRun = resyncContext
    ? await runConnectorSync({
        connector: input.connector,
        context: resyncContext,
      })
    : null;
  if (resyncRun && resyncRun.page.mode !== 'initial') {
    throw new Error(`connector ${manifest.id} resync did not restart with an initial page`);
  }

  const cursorExpiredContext = suite?.buildCursorExpiredContext
    ? await suite.buildCursorExpiredContext({
        baseContext: input.context,
        initialRun,
      })
    : null;
  const cursorRecoveryRun = cursorExpiredContext
    ? await runConnectorSync({
        connector: input.connector,
        context: cursorExpiredContext,
      })
    : null;
  if (cursorRecoveryRun && cursorRecoveryRun.page.mode !== 'initial') {
    throw new Error(`connector ${manifest.id} did not recover from an expired cursor`);
  }

  let rateLimitError: ClassifiedConnectorError | null = null;
  const rateLimitContext = suite?.buildRateLimitContext
    ? await suite.buildRateLimitContext({
        baseContext: input.context,
        initialRun,
      })
    : null;
  if (rateLimitContext) {
    try {
      await runConnectorSync({
        connector: input.connector,
        context: rateLimitContext,
      });
      throw new Error(`connector ${manifest.id} did not raise a typed rate-limit error`);
    } catch (error) {
      rateLimitError = classifyConnectorError(error);
      if (rateLimitError.kind !== 'rate_limit' || !rateLimitError.retryable) {
        throw new Error(
          `connector ${manifest.id} did not classify rate limiting as a retryable error`,
        );
      }
    }
  }

  let healthcheck: ConnectionHealthReport | null = null;
  if (lifecycle.healthcheck) {
    healthcheck = parseConnectionHealthReport(
      (await runConnectorHealthcheck({
        connector: input.connector,
        context: { ...input.context, cursor: null },
      }))!,
    );
  }

  let revoked = false;
  if (lifecycle.revoke) {
    const revokeContext = suite?.buildRevokeContext
      ? await suite.buildRevokeContext(input.context)
      : input.context;
    await lifecycle.revoke(revokeContext);
    revoked = true;
  }

  return {
    manifestId: manifest.id,
    initialRun,
    incrementalRun,
    replayRun,
    resyncRun,
    cursorRecoveryRun,
    rateLimitError,
    healthcheck,
    revoked,
  };
}

export async function runConnectorCertificationSmoke<TRaw>(input: {
  connector: RegisteredConnector<TRaw>;
  context: ConnectorSyncContext;
}): Promise<ConnectorSyncRun<TRaw>> {
  return (await runConnectorCertification(input)).initialRun;
}

function assertRecordProvenance<TRaw>(
  connectorId: string,
  run: ConnectorSyncRun<TRaw>,
) {
  for (const record of run.records) {
    const provenance = record.envelope.provenance;
    if (!provenance || Object.keys(provenance).length === 0) {
      throw new Error(`connector ${connectorId} emitted a record without provenance`);
    }
  }
}

function assertReplayIdempotency<TRaw>(
  connectorId: string,
  initialRun: ConnectorSyncRun<TRaw>,
  replayRun: ConnectorSyncRun<TRaw>,
) {
  const initialByExternalId = new Map(
    initialRun.records.map((record) => [
      record.externalObject.externalId,
      record.capture.idempotencyKey,
    ]),
  );

  for (const record of replayRun.records) {
    const initialKey = initialByExternalId.get(record.externalObject.externalId);
    if (initialKey && initialKey !== record.capture.idempotencyKey) {
      throw new Error(
        `connector ${connectorId} replay changed idempotency key for ${record.externalObject.externalId}`,
      );
    }
  }
}

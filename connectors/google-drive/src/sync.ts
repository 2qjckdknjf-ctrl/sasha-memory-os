import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  resolvePullCredentials,
  runConnectorSync,
  vaultRefForAccount,
  type ConnectionHealthReport,
  type ConnectorSyncContext,
  type ConnectorSyncPage,
  type ExternalObject,
  type NormalizedConnectorRecord,
  type RegisteredConnector,
  type SyncCursor,
  type VaultStore,
} from '@memory-os/connector-sdk';

export type DriveSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type DrivePullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: DriveSyncDelta[];
  nextCursor?: SyncCursor | null;
};

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  parents?: string[];
  __mode?: 'stub' | 'vault';
};

type DriveListResponse = {
  files?: DriveFile[];
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DRIVE_CURSOR_STREAM = 'google-drive:files';
const DRIVE_CURSOR_SCHEMA_VERSION = '1.0';
const DRIVE_PAGE_SIZE = 5;

function labelForDriveAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Google Drive';
}

function buildStubDriveFiles(input: {
  connectionId: string;
  displayName?: string;
}): DriveFile[] {
  return [
    {
      id: `stub-${input.connectionId.slice(0, 8)}-brief`,
      name: 'Project brief.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      modifiedTime: new Date().toISOString(),
      parents: ['aistroyka'],
      __mode: 'stub',
    },
  ];
}

function driveFileExternalId(file: DriveFile): string {
  return `file/${String(file.id ?? 'unknown')}`;
}

function normalizeDriveFile(input: {
  workspaceId: string;
  connectionId: string;
  displayName?: string;
  file: DriveFile;
}): NormalizedConnectorRecord {
  const label = labelForDriveAccount(input);
  const externalId = driveFileExternalId(input.file);
  const observedAt = input.file.modifiedTime ?? new Date().toISOString();
  const sourceMode = input.file.__mode ?? 'vault';
  const title = input.file.name?.trim() || '(untitled file)';
  const canonicalReference =
    sourceMode === 'vault' && input.file.id
      ? `https://drive.google.com/file/d/${encodeURIComponent(input.file.id)}/view`
      : undefined;
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}`;
  const object: ExternalObject = {
    provider: 'google-drive',
    accountId: input.connectionId,
    externalId,
    externalVersion: input.file.modifiedTime,
    objectType: 'file',
    title,
    contentReference: canonicalReference,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: false,
    attachments: [],
    permissionsSnapshot: {},
    metadata: {
      mimeType: input.file.mimeType ?? 'unknown',
      parentIds: input.file.parents ?? [],
      sourceMode,
    },
    canonicalReference,
  };
  const note =
    sourceMode === 'stub'
      ? 'Synthetic Google Drive sync (vault credentials not read).'
      : 'Source: vault-backed Google Drive files.list.';
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'google-drive',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: input.file.modifiedTime,
      },
      event_type: 'google-drive.file.updated',
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        reference: canonicalReference,
        text: `${label}: ${title}`,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: 'reference',
      },
      provenance: {
        mimeType: input.file.mimeType ?? 'unknown',
        sourceMode,
      },
    },
    capture: {
      title: `${label}: ${title}`,
      text: [
        `Connector: Google Drive (${sourceMode})`,
        `File: ${title}`,
        `MIME type: ${input.file.mimeType ?? 'unknown'}`,
        input.file.modifiedTime ? `Modified: ${input.file.modifiedTime}` : 'Modified: unknown',
        canonicalReference ? `Reference: ${canonicalReference}` : null,
        note,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
      filename: `google-drive://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

function filterIncrementalDriveFiles(
  files: DriveFile[],
  cursor: SyncCursor | null | undefined,
): DriveFile[] {
  if (!cursor?.opaque) return files;
  const lastSeenFileId =
    typeof cursor.opaque.lastSeenFileId === 'string' ? cursor.opaque.lastSeenFileId : null;
  const lastSeenModifiedAt =
    typeof cursor.opaque.lastSeenModifiedAt === 'string'
      ? Date.parse(cursor.opaque.lastSeenModifiedAt)
      : Number.NaN;
  const next: DriveFile[] = [];
  for (const file of files) {
    const currentFileId = String(file.id ?? '');
    if (lastSeenFileId && currentFileId === lastSeenFileId) break;
    const modifiedAt = Date.parse(file.modifiedTime ?? '');
    if (Number.isFinite(lastSeenModifiedAt) && Number.isFinite(modifiedAt)) {
      if (modifiedAt < lastSeenModifiedAt) break;
      if (modifiedAt === lastSeenModifiedAt && !lastSeenFileId) break;
    }
    next.push(file);
  }
  return next;
}

async function syncGoogleDriveFiles(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<DriveFile>> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-drive',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (creds.mode === 'stub') {
    const rawObjects =
      mode === 'incremental'
        ? []
        : buildStubDriveFiles({
            connectionId: context.account.connectionId,
            displayName: context.account.displayName,
          });
    const head = rawObjects[0];
    return {
      stream: DRIVE_CURSOR_STREAM,
      mode,
      rawObjects,
      pullMode: 'stub',
      note: 'synthetic Google Drive sync; vault credentials not read',
      nextCursor:
        mode === 'incremental' || !head?.id
          ? context.cursor ?? null
          : buildDefaultCursor(
              DRIVE_CURSOR_STREAM,
              {
                lastSeenFileId: String(head.id),
                lastSeenModifiedAt: head.modifiedTime ?? new Date().toISOString(),
              },
              DRIVE_CURSOR_SCHEMA_VERSION,
            ),
    };
  }

  const response = await (context.fetchImpl ?? fetch)(
    `https://www.googleapis.com/drive/v3/files?pageSize=${DRIVE_PAGE_SIZE}&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,parents)`,
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Google Drive files API failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as DriveListResponse;
  const fetched = (payload.files ?? [])
    .filter((file) => file.id && file.name)
    .map((file) => ({ ...file, __mode: 'vault' as const }));
  const rawObjects =
    mode === 'incremental' ? filterIncrementalDriveFiles(fetched, context.cursor) : fetched;
  return {
    stream: DRIVE_CURSOR_STREAM,
    mode,
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'vault-backed Google Drive files ingested'
        : 'vault-backed Google Drive sync found no new files',
  };
}

async function checkpointDriveFiles(input: {
  page: ConnectorSyncPage<DriveFile>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const head = input.page.rawObjects[0];
  if (!head?.id) return input.previousCursor;
  return buildDefaultCursor(
    input.page.stream,
    {
      lastSeenFileId: String(head.id),
      lastSeenModifiedAt: head.modifiedTime ?? new Date().toISOString(),
    },
    DRIVE_CURSOR_SCHEMA_VERSION,
  );
}

async function healthcheckGoogleDrive(
  context: ConnectorSyncContext,
): Promise<ConnectionHealthReport> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-drive',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (creds.mode === 'stub') {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-drive',
      status: 'reauth_required',
      note: 'Google Drive vault token missing; OAuth reconnect required',
      vaultRef,
      checks: [
        {
          name: 'oauth_token',
          status: 'fail',
          detail: 'Vault token missing; connector is running in stub fallback mode.',
        },
      ],
    });
  }

  const response = await (context.fetchImpl ?? fetch)(
    'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  if (response.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-drive',
      status: 'healthy',
      note: 'Google Drive OAuth token is valid and the files probe succeeded',
      vaultRef,
      checks: [
        {
          name: 'oauth_token',
          status: 'pass',
          detail: 'Vault token loaded successfully.',
        },
        {
          name: 'provider_probe',
          status: 'pass',
          detail: 'Google Drive files probe returned HTTP 200.',
        },
      ],
    });
  }

  if (response.status === 401 || response.status === 403) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-drive',
      status: 'reauth_required',
      note: `Google Drive rejected the stored OAuth token with HTTP ${response.status}`,
      vaultRef,
      checks: [
        {
          name: 'provider_probe',
          status: 'fail',
          detail: `Google Drive files probe returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  return buildConnectionHealthReport({
    connectionId: context.account.connectionId,
    connectorId: 'google-drive',
    status: 'degraded',
    note: `Google Drive health probe failed with HTTP ${response.status}`,
    vaultRef,
    checks: [
      {
        name: 'provider_probe',
        status: 'warn',
        detail: `Google Drive files probe returned HTTP ${response.status}.`,
      },
    ],
  });
}

export const googleDriveConnector: RegisteredConnector<DriveFile> = {
  manifest: {
    id: 'google-drive',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: DRIVE_CURSOR_STREAM,
    auth: 'oauth2',
    capabilities: ['files.read', 'changes.list'],
    supports: {
      discover: false,
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      live_fetch: false,
      webhooks: false,
      write: false,
    },
    storage_modes: ['reference', 'indexed'],
    rate_limit_strategy: 'provider_headers',
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync(context) {
      return syncGoogleDriveFiles(context, 'initial');
    },
    async incrementalSync(context) {
      return syncGoogleDriveFiles(context, 'incremental');
    },
    async normalize(context) {
      return normalizeDriveFile({
        workspaceId: context.workspaceId,
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
        file: context.rawObject,
      });
    },
    async checkpoint({ page, previousCursor }) {
      return checkpointDriveFiles({ page, previousCursor });
    },
    async healthcheck(context) {
      return healthcheckGoogleDrive(context);
    },
    async revoke(context) {
      if (context.vault && context.account.vaultRef) {
        await context.vault.delete(context.account.vaultRef);
      }
    },
  },
};

/** Stub Drive delta: invents file change events from vault ref only. */
export function pullGoogleDriveStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): DrivePullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'google-drive',
      accountId: input.connectionId,
    });
  const items = buildStubDriveFiles({
    connectionId: input.connectionId,
    displayName: input.displayName,
  }).map((file) => {
    const record = normalizeDriveFile({
      workspaceId: DEFAULT_WORKSPACE_ID,
      connectionId: input.connectionId,
      displayName: input.displayName,
      file,
    });
    return {
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    };
  });
  const head = buildStubDriveFiles({
    connectionId: input.connectionId,
    displayName: input.displayName,
  })[0];

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Google Drive sync; vault credentials not read',
    items,
    nextCursor: head?.id
      ? buildDefaultCursor(
          DRIVE_CURSOR_STREAM,
          {
            lastSeenFileId: String(head.id),
            lastSeenModifiedAt: head.modifiedTime ?? new Date().toISOString(),
          },
          DRIVE_CURSOR_SCHEMA_VERSION,
        )
      : null,
  };
}

/** Pull Drive deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGoogleDriveDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  workspaceId?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  cursor?: SyncCursor | null;
}): Promise<DrivePullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-drive',
      accountId: input.connectionId,
    });
  const syncRun = await runConnectorSync({
    connector: googleDriveConnector,
    context: {
      account: {
        connectionId: input.connectionId,
        connectorId: 'google-drive',
        displayName: input.displayName,
        vaultRef,
      },
      workspaceId:
        input.workspaceId ??
        processEnv.MEMORY_OS_WORKSPACE_ID ??
        DEFAULT_WORKSPACE_ID,
      processEnv: {
        ...processEnv,
        MEMORY_OS_ENV: envName,
      },
      vault: input.vault,
      fetchImpl: input.fetchImpl ?? fetch,
      cursor: input.cursor ?? null,
    },
  });
  return {
    vaultRef,
    mode: syncRun.page.pullMode === 'stub' ? 'stub' : 'vault',
    note: syncRun.page.note ?? 'Google Drive connector sync completed',
    items: syncRun.records.map((record) => ({
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    })),
    nextCursor: syncRun.nextCursor,
  };
}

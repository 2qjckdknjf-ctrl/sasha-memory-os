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

export type GmailSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type GmailPullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: GmailSyncDelta[];
  nextCursor?: SyncCursor | null;
};

type GmailListResponse = {
  messages?: Array<{ id?: string }>;
};

type GmailMessage = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
  __mode?: 'stub' | 'vault';
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GMAIL_CURSOR_STREAM = 'gmail:messages';
const GMAIL_CURSOR_SCHEMA_VERSION = '1.0';
const GMAIL_PAGE_SIZE = 5;

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  const hit = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() || null;
}

function labelForGmailAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Gmail';
}

function buildStubGmailMessages(input: {
  connectionId: string;
  displayName?: string;
}): GmailMessage[] {
  return [
    {
      id: `stub-${input.connectionId.slice(0, 8)}-pilot`,
      snippet: 'Memory OS pilot kickoff',
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: 'Subject', value: 'Memory OS pilot kickoff' },
          { name: 'From', value: 'owner@example.com' },
        ],
      },
      __mode: 'stub',
    },
  ];
}

function gmailMessageExternalId(message: GmailMessage): string {
  return `msg/${String(message.id ?? 'unknown')}`;
}

function normalizeGmailMessage(input: {
  workspaceId: string;
  connectionId: string;
  displayName?: string;
  message: GmailMessage;
}): NormalizedConnectorRecord {
  const label = labelForGmailAccount(input);
  const externalId = gmailMessageExternalId(input.message);
  const subject = headerValue(input.message.payload?.headers, 'Subject') ?? '(no subject)';
  const from = headerValue(input.message.payload?.headers, 'From') ?? 'unknown';
  const observedAt = input.message.internalDate
    ? new Date(Number(input.message.internalDate)).toISOString()
    : new Date().toISOString();
  const sourceMode = input.message.__mode ?? 'vault';
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}`;
  const object: ExternalObject = {
    provider: 'gmail',
    accountId: input.connectionId,
    externalId,
    externalVersion: input.message.internalDate,
    objectType: 'message_metadata',
    title: subject,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: false,
    attachments: [],
    permissionsSnapshot: {},
    metadata: {
      from,
      snippet: input.message.snippet ?? null,
      sourceMode,
    },
  };
  const note =
    sourceMode === 'stub'
      ? 'Synthetic Gmail sync (stub connector; bodies not stored).'
      : 'Source: vault-backed Gmail messages.list + metadata.';
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'gmail',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: input.message.internalDate,
      },
      event_type: 'gmail.message.metadata',
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        text: `${label}: ${subject}`,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: 'reference',
      },
      provenance: {
        from,
        sourceMode,
      },
    },
    capture: {
      title: `${label}: ${subject}`,
      text: [
        `Connector: Gmail (${sourceMode})`,
        `From: ${from}`,
        `Subject: ${subject}`,
        input.message.snippet
          ? `Snippet: ${input.message.snippet}`
          : 'Metadata-only Gmail pull (no full body stored).',
        note,
      ].join('\n'),
      filename: `gmail://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

function filterIncrementalGmailMessages(
  messages: GmailMessage[],
  cursor: SyncCursor | null | undefined,
): GmailMessage[] {
  if (!cursor?.opaque) return messages;
  const lastSeenMessageId =
    typeof cursor.opaque.lastSeenMessageId === 'string'
      ? cursor.opaque.lastSeenMessageId
      : null;
  const lastSeenObservedAt =
    typeof cursor.opaque.lastSeenObservedAt === 'string'
      ? Date.parse(cursor.opaque.lastSeenObservedAt)
      : Number.NaN;
  const next: GmailMessage[] = [];
  for (const message of messages) {
    const currentMessageId = String(message.id ?? '');
    if (lastSeenMessageId && currentMessageId === lastSeenMessageId) break;
    const observedAt = message.internalDate ? Number(message.internalDate) : Number.NaN;
    if (Number.isFinite(lastSeenObservedAt) && Number.isFinite(observedAt)) {
      if (observedAt < lastSeenObservedAt) break;
      if (observedAt === lastSeenObservedAt && !lastSeenMessageId) break;
    }
    next.push(message);
  }
  return next;
}

async function syncGmailMessages(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<GmailMessage>> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'gmail',
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
        : buildStubGmailMessages({
            connectionId: context.account.connectionId,
            displayName: context.account.displayName,
          });
    const head = rawObjects[0];
    return {
      stream: GMAIL_CURSOR_STREAM,
      mode,
      rawObjects,
      pullMode: 'stub',
      note: 'synthetic Gmail sync; vault credentials not read',
      nextCursor:
        mode === 'incremental' || !head?.id
          ? context.cursor ?? null
          : buildDefaultCursor(
              GMAIL_CURSOR_STREAM,
              {
                lastSeenMessageId: String(head.id),
                lastSeenObservedAt: head.internalDate
                  ? new Date(Number(head.internalDate)).toISOString()
                  : new Date().toISOString(),
              },
              GMAIL_CURSOR_SCHEMA_VERSION,
            ),
    };
  }

  const listRes = await (context.fetchImpl ?? fetch)(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${GMAIL_PAGE_SIZE}&labelIds=INBOX`,
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!listRes.ok) {
    throw new Error(`Gmail list API failed: HTTP ${listRes.status}`);
  }
  const list = (await listRes.json()) as GmailListResponse;
  const ids = (list.messages ?? [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, GMAIL_PAGE_SIZE);
  const fetched: GmailMessage[] = [];
  for (const id of ids) {
    const msgRes = await (context.fetchImpl ?? fetch)(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          Accept: 'application/json',
        },
      },
    );
    if (!msgRes.ok) continue;
    fetched.push({ ...((await msgRes.json()) as GmailMessage), __mode: 'vault' });
  }
  const rawObjects =
    mode === 'incremental'
      ? filterIncrementalGmailMessages(fetched, context.cursor)
      : fetched;
  return {
    stream: GMAIL_CURSOR_STREAM,
    mode,
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'vault-backed Gmail metadata ingested'
        : 'vault-backed Gmail sync found no new messages',
  };
}

async function checkpointGmailMessages(input: {
  page: ConnectorSyncPage<GmailMessage>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const head = input.page.rawObjects[0];
  if (!head?.id) return input.previousCursor;
  return buildDefaultCursor(
    input.page.stream,
    {
      lastSeenMessageId: String(head.id),
      lastSeenObservedAt: head.internalDate
        ? new Date(Number(head.internalDate)).toISOString()
        : new Date().toISOString(),
    },
    GMAIL_CURSOR_SCHEMA_VERSION,
  );
}

async function healthcheckGmail(context: ConnectorSyncContext): Promise<ConnectionHealthReport> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'gmail',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (creds.mode === 'stub') {
    const hasVaultRef = Boolean(context.account.vaultRef);
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'gmail',
      status: hasVaultRef ? 'reauth_required' : 'healthy',
      note: hasVaultRef
        ? 'Gmail vault token missing; OAuth reconnect required'
        : 'Gmail remains an explicit stub connector in this slice.',
      vaultRef,
      checks: [
        {
          name: hasVaultRef ? 'oauth_token' : 'stub_mode',
          status: hasVaultRef ? 'fail' : 'warn',
          detail: hasVaultRef
            ? 'Vault token missing; Gmail requires OAuth reconnect.'
            : 'Gmail is intentionally running in stub mode until a fuller OAuth path is enabled.',
        },
      ],
    });
  }

  const response = await (context.fetchImpl ?? fetch)(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&labelIds=INBOX',
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
      connectorId: 'gmail',
      status: 'healthy',
      note: 'Gmail OAuth token is valid and the inbox metadata probe succeeded',
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
          detail: 'Gmail messages probe returned HTTP 200.',
        },
      ],
    });
  }

  if (response.status === 401 || response.status === 403) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'gmail',
      status: 'reauth_required',
      note: `Gmail rejected the stored OAuth token with HTTP ${response.status}`,
      vaultRef,
      checks: [
        {
          name: 'provider_probe',
          status: 'fail',
          detail: `Gmail messages probe returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  return buildConnectionHealthReport({
    connectionId: context.account.connectionId,
    connectorId: 'gmail',
    status: 'degraded',
    note: `Gmail health probe failed with HTTP ${response.status}`,
    vaultRef,
    checks: [
      {
        name: 'provider_probe',
        status: 'warn',
        detail: `Gmail messages probe returned HTTP ${response.status}.`,
      },
    ],
  });
}

export const gmailConnector: RegisteredConnector<GmailMessage> = {
  manifest: {
    id: 'gmail',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: GMAIL_CURSOR_STREAM,
    auth: 'oauth2',
    capabilities: ['messages.metadata', 'labels.read'],
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
      return syncGmailMessages(context, 'initial');
    },
    async incrementalSync(context) {
      return syncGmailMessages(context, 'incremental');
    },
    async normalize(context) {
      return normalizeGmailMessage({
        workspaceId: context.workspaceId,
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
        message: context.rawObject,
      });
    },
    async checkpoint({ page, previousCursor }) {
      return checkpointGmailMessages({ page, previousCursor });
    },
    async healthcheck(context) {
      return healthcheckGmail(context);
    },
    async revoke(context) {
      if (context.vault && context.account.vaultRef) {
        await context.vault.delete(context.account.vaultRef);
      }
    },
  },
};

/** Stub Gmail delta: invents metadata-only message events from vault ref. */
export function pullGmailStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): GmailPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'gmail',
      accountId: input.connectionId,
    });
  const items = buildStubGmailMessages({
    connectionId: input.connectionId,
    displayName: input.displayName,
  }).map((message) => {
    const record = normalizeGmailMessage({
      workspaceId: DEFAULT_WORKSPACE_ID,
      connectionId: input.connectionId,
      displayName: input.displayName,
      message,
    });
    return {
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    };
  });
  const head = buildStubGmailMessages({
    connectionId: input.connectionId,
    displayName: input.displayName,
  })[0];

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Gmail sync; vault credentials not read',
    items,
    nextCursor: head?.id
      ? buildDefaultCursor(
          GMAIL_CURSOR_STREAM,
          {
            lastSeenMessageId: String(head.id),
            lastSeenObservedAt: head.internalDate
              ? new Date(Number(head.internalDate)).toISOString()
              : new Date().toISOString(),
          },
          GMAIL_CURSOR_SCHEMA_VERSION,
        )
      : null,
  };
}

/** Pull Gmail deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGmailDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  workspaceId?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  cursor?: SyncCursor | null;
}): Promise<GmailPullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'gmail',
      accountId: input.connectionId,
    });
  const syncRun = await runConnectorSync({
    connector: gmailConnector,
    context: {
      account: {
        connectionId: input.connectionId,
        connectorId: 'gmail',
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
    note: syncRun.page.note ?? 'Gmail connector sync completed',
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

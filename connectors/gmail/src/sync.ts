import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  classifyConnectorError,
  connectorCursorExpiredError,
  connectorRateLimitError,
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

type GmailStorageMode = 'reference' | 'indexed';

type GmailSelectedLabel = {
  collectionId: string;
  externalId: string;
  name: string;
  title: string;
  storageMode: GmailStorageMode;
};

type GmailKnownMessage = {
  id: string;
  collectionId: string;
  storageMode: GmailStorageMode;
  title: string | null;
  selectedLabelIds: string[];
};

type GmailCursorState = {
  startHistoryId: string | null;
  scopeKey: string | null;
  knownMessages: GmailKnownMessage[];
};

type GmailMessageBody = {
  data?: string;
  size?: number;
  attachmentId?: string;
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  body?: GmailMessageBody;
  headers?: Array<{ name?: string; value?: string }>;
  parts?: GmailMessagePart[];
};

type GmailHistoryMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  historyId?: string;
  internalDate?: string;
};

type GmailHistoryEntry = {
  id?: string;
  messagesAdded?: Array<{ message?: GmailHistoryMessage }>;
  messagesDeleted?: Array<{ message?: GmailHistoryMessage }>;
  labelsAdded?: Array<{ message?: GmailHistoryMessage; labelIds?: string[] }>;
  labelsRemoved?: Array<{ message?: GmailHistoryMessage; labelIds?: string[] }>;
};

type GmailHistoryResponse = {
  history?: GmailHistoryEntry[];
  nextPageToken?: string;
  historyId?: string;
};

type GmailListResponse = {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
};

type GmailMessage = GmailHistoryMessage & {
  snippet?: string;
  payload?: {
    mimeType?: string;
    headers?: Array<{ name?: string; value?: string }>;
    body?: GmailMessageBody;
    parts?: GmailMessagePart[];
  };
  collectionId?: string;
  storageMode?: GmailStorageMode;
  selectedLabelIds?: string[];
  bodyText?: string | null;
  changeState?: 'active' | 'deleted' | 'label_removed' | 'missing_from_selected_resync';
  __mode?: 'stub' | 'vault';
  deleted?: boolean;
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GMAIL_CURSOR_STREAM = 'gmail:messages';
const GMAIL_CURSOR_SCHEMA_VERSION = '2.0';
const GMAIL_PAGE_SIZE = 50;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeGmailStorageMode(value: unknown): GmailStorageMode {
  return value === 'indexed' ? 'indexed' : 'reference';
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  const hit = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() || null;
}

function labelForGmailAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Gmail';
}

function deriveGmailLabelExternalId(collectionId: string): string | null {
  const prefix = 'gmail:label:';
  return collectionId.startsWith(prefix) ? collectionId.slice(prefix.length) : null;
}

export function resolveGmailSelectedLabels(metadata: unknown): GmailSelectedLabel[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.collections)) return [];
  if (metadata.collections.selection_mode !== 'selected') return [];
  const excluded = new Set(
    Array.isArray(metadata.collections.excluded_ids)
      ? metadata.collections.excluded_ids.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [],
  );
  const rawItems = Array.isArray(metadata.collections.items) ? metadata.collections.items : [];
  return rawItems.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const collectionId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!collectionId || excluded.has(collectionId)) return [];
    const kind = typeof item.kind === 'string' ? item.kind : 'collection';
    if (kind !== 'label' && kind !== 'collection') return [];
    const externalId =
      typeof item.external_id === 'string' && item.external_id.trim().length > 0
        ? item.external_id.trim()
        : deriveGmailLabelExternalId(collectionId);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const title =
      typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : name;
    if (!externalId || !name || !title) return [];
    const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
    return [
      {
        collectionId,
        externalId,
        name,
        title,
        storageMode: normalizeGmailStorageMode(itemMetadata.storage_mode),
      } satisfies GmailSelectedLabel,
    ];
  });
}

export function validateGmailSelectionScope(metadata: unknown): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!isPlainObject(metadata) || !isPlainObject(metadata.collections)) {
    missing.push('metadata.collections');
    return { ok: false, missing };
  }
  if (metadata.collections.selection_mode !== 'selected') {
    missing.push('collections.selection_mode=selected');
  }
  if (resolveGmailSelectedLabels(metadata).length === 0) {
    missing.push('selected Gmail labels');
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

function buildGmailScopeKey(labels: GmailSelectedLabel[]): string {
  return labels
    .map((label) => `${label.collectionId}:${label.externalId}:${label.storageMode}`)
    .sort()
    .join('|');
}

function parseGmailCursorState(cursor: SyncCursor | null | undefined): GmailCursorState {
  const knownMessages = Array.isArray(cursor?.opaque?.knownMessages)
    ? cursor.opaque.knownMessages.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const collectionId =
          typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
        if (!id || !collectionId) return [];
        return [
          {
            id,
            collectionId,
            storageMode: normalizeGmailStorageMode(entry.storageMode),
            title: typeof entry.title === 'string' ? entry.title : null,
            selectedLabelIds: Array.isArray(entry.selectedLabelIds)
              ? entry.selectedLabelIds.filter(
                  (value): value is string => typeof value === 'string' && value.trim().length > 0,
                )
              : [],
          } satisfies GmailKnownMessage,
        ];
      })
    : [];
  return {
    startHistoryId:
      typeof cursor?.opaque?.startHistoryId === 'string' ? cursor.opaque.startHistoryId : null,
    scopeKey: typeof cursor?.opaque?.scopeKey === 'string' ? cursor.opaque.scopeKey : null,
    knownMessages,
  };
}

function buildGmailCursor(input: {
  startHistoryId: string | null;
  selectedLabels: GmailSelectedLabel[];
  knownMessages: Iterable<GmailKnownMessage>;
}): SyncCursor {
  return buildDefaultCursor(
    GMAIL_CURSOR_STREAM,
    {
      startHistoryId: input.startHistoryId,
      scopeKey: buildGmailScopeKey(input.selectedLabels),
      knownMessages: [...input.knownMessages],
    },
    GMAIL_CURSOR_SCHEMA_VERSION,
  );
}

function gmailMessageExternalId(message: Pick<GmailMessage, 'id'>): string {
  return `msg/${String(message.id ?? 'unknown')}`;
}

function parseGmailMessageExternalId(externalId: string): string {
  return externalId.startsWith('msg/') ? externalId.slice(4) : externalId;
}

function compareNumericStrings(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  try {
    const leftBig = BigInt(left);
    const rightBig = BigInt(right);
    if (leftBig === rightBig) return 0;
    return leftBig > rightBig ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

function maxGmailHistoryId(left: string | null, right: string | null): string | null {
  return compareNumericStrings(left, right) >= 0 ? left : right;
}

function sanitizeObservedAt(internalDate?: string): string {
  if (!internalDate) return new Date().toISOString();
  const stamp = new Date(Number(internalDate));
  return Number.isNaN(stamp.valueOf()) ? new Date().toISOString() : stamp.toISOString();
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function extractGmailBodyText(part: GmailMessagePart | undefined): string | null {
  if (!part) return null;
  if (
    part.mimeType === 'text/plain' &&
    typeof part.body?.data === 'string' &&
    part.body.data.length > 0
  ) {
    return decodeBase64Url(part.body.data).trim() || null;
  }
  for (const child of part.parts ?? []) {
    const text = extractGmailBodyText(child);
    if (text) return text;
  }
  if (
    !part.parts?.length &&
    typeof part.body?.data === 'string' &&
    part.body.data.length > 0 &&
    (part.mimeType === undefined || part.mimeType === 'text/plain')
  ) {
    return decodeBase64Url(part.body.data).trim() || null;
  }
  return null;
}

function choosePrimaryGmailLabel(labels: GmailSelectedLabel[]): GmailSelectedLabel | null {
  if (labels.length === 0) return null;
  return [...labels].sort((left, right) => {
    if (left.storageMode !== right.storageMode) {
      return left.storageMode === 'indexed' ? -1 : 1;
    }
    return left.collectionId.localeCompare(right.collectionId);
  })[0]!;
}

function resolveEffectiveGmailSelection(input: {
  selectedLabels: GmailSelectedLabel[];
  messageLabelIds?: string[];
  hintedSelectedLabelIds?: Iterable<string>;
}): {
  matchedLabels: GmailSelectedLabel[];
  primaryLabel: GmailSelectedLabel | null;
  storageMode: GmailStorageMode;
} {
  const activeLabelIds = new Set<string>();
  for (const labelId of input.messageLabelIds ?? []) {
    if (typeof labelId === 'string' && labelId.trim().length > 0) {
      activeLabelIds.add(labelId.trim());
    }
  }
  if (activeLabelIds.size === 0) {
    for (const labelId of input.hintedSelectedLabelIds ?? []) {
      if (typeof labelId === 'string' && labelId.trim().length > 0) {
        activeLabelIds.add(labelId.trim());
      }
    }
  }
  const matchedLabels = input.selectedLabels.filter((label) => activeLabelIds.has(label.externalId));
  return {
    matchedLabels,
    primaryLabel: choosePrimaryGmailLabel(matchedLabels),
    storageMode: matchedLabels.some((label) => label.storageMode === 'indexed')
      ? 'indexed'
      : 'reference',
  };
}

function buildActiveGmailMessage(input: {
  message: GmailMessage;
  selectedLabels: GmailSelectedLabel[];
  hintedSelectedLabelIds?: Iterable<string>;
  mode: 'stub' | 'vault';
}): GmailMessage | null {
  const effective = resolveEffectiveGmailSelection({
    selectedLabels: input.selectedLabels,
    messageLabelIds: input.message.labelIds,
    hintedSelectedLabelIds: input.hintedSelectedLabelIds,
  });
  if (!input.message.id || !effective.primaryLabel) return null;
  return {
    ...input.message,
    __mode: input.mode,
    deleted: false,
    changeState: 'active',
    collectionId: effective.primaryLabel.collectionId,
    storageMode: effective.storageMode,
    selectedLabelIds: effective.matchedLabels.map((label) => label.externalId),
    bodyText:
      effective.storageMode === 'indexed'
        ? extractGmailBodyText(input.message.payload) ?? input.message.bodyText ?? null
        : null,
  };
}

function buildGmailTombstone(input: {
  messageId: string;
  observedAt: string;
  collectionId: string;
  storageMode: GmailStorageMode;
  title?: string | null;
  selectedLabelIds?: string[];
  changeState: 'deleted' | 'label_removed' | 'missing_from_selected_resync';
  historyId?: string | null;
}): GmailMessage {
  return {
    id: input.messageId,
    internalDate: String(Date.parse(input.observedAt)),
    historyId: input.historyId ?? undefined,
    payload: {
      headers: input.title ? [{ name: 'Subject', value: input.title }] : [],
    },
    __mode: 'vault',
    deleted: true,
    changeState: input.changeState,
    collectionId: input.collectionId,
    storageMode: input.storageMode,
    selectedLabelIds: input.selectedLabelIds ?? [],
    bodyText: null,
  };
}

function buildKnownGmailMessage(rawObject: GmailMessage): GmailKnownMessage | null {
  if (!rawObject.id || rawObject.deleted || !rawObject.collectionId) return null;
  return {
    id: rawObject.id,
    collectionId: rawObject.collectionId,
    storageMode: normalizeGmailStorageMode(rawObject.storageMode),
    title: headerValue(rawObject.payload?.headers, 'Subject'),
    selectedLabelIds: rawObject.selectedLabelIds ?? [],
  };
}

function buildStubGmailMessages(input: {
  connectionId: string;
  metadata?: Record<string, unknown>;
}): GmailMessage[] {
  const selectedLabel = resolveGmailSelectedLabels(input.metadata)[0];
  if (!selectedLabel) return [];
  const internalDate = String(Date.now());
  return [
    {
      id: `stub-${input.connectionId.slice(0, 8)}-pilot`,
      historyId: 'stub-history-1',
      labelIds: [selectedLabel.externalId],
      snippet: 'Memory OS pilot kickoff',
      internalDate,
      payload: {
        headers: [
          { name: 'Subject', value: 'Memory OS pilot kickoff' },
          { name: 'From', value: 'owner@example.com' },
        ],
      },
      __mode: 'stub',
      deleted: false,
      changeState: 'active',
      collectionId: selectedLabel.collectionId,
      storageMode: selectedLabel.storageMode,
      selectedLabelIds: [selectedLabel.externalId],
      bodyText:
        selectedLabel.storageMode === 'indexed'
          ? 'This indexed Gmail label opted into storing the message body.'
          : null,
    },
  ];
}

function buildGmailHeaders(input: { accessToken: string }): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    Accept: 'application/json',
  };
}

async function listGmailMessageIdsForLabel(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  labelId: string;
}): Promise<string[]> {
  const ids = new Set<string>();
  let pageToken: string | null = null;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('labelIds', input.labelId);
    url.searchParams.set('maxResults', String(GMAIL_PAGE_SIZE));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const response = await input.fetchImpl(url.toString(), {
      headers: buildGmailHeaders({ accessToken: input.accessToken }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw connectorRateLimitError({
          message: `Gmail messages.list failed: HTTP ${response.status}`,
        });
      }
      throw new Error(`Gmail messages.list failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as GmailListResponse;
    for (const message of payload.messages ?? []) {
      if (typeof message.id === 'string' && message.id.trim().length > 0) {
        ids.add(message.id.trim());
      }
    }
    pageToken =
      typeof payload.nextPageToken === 'string' && payload.nextPageToken.length > 0
        ? payload.nextPageToken
        : null;
  } while (pageToken);
  return [...ids];
}

async function fetchGmailMessage(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  messageId: string;
  format: 'metadata' | 'full';
}): Promise<GmailMessage | null> {
  const url = new URL(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}`,
  );
  url.searchParams.set('format', input.format);
  url.searchParams.append('metadataHeaders', 'Subject');
  url.searchParams.append('metadataHeaders', 'From');
  const response = await input.fetchImpl(url.toString(), {
    headers: buildGmailHeaders({ accessToken: input.accessToken }),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 429) {
      throw connectorRateLimitError({
        message: `Gmail messages.get failed: HTTP ${response.status}`,
      });
    }
    throw new Error(`Gmail messages.get failed: HTTP ${response.status}`);
  }
  return (await response.json()) as GmailMessage;
}

async function listGmailHistorySince(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  startHistoryId: string;
  labelId: string;
}): Promise<{
  history: GmailHistoryEntry[];
  latestHistoryId: string | null;
}> {
  const history: GmailHistoryEntry[] = [];
  let pageToken: string | null = null;
  let latestHistoryId: string | null = null;
  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
    url.searchParams.set('startHistoryId', input.startHistoryId);
    url.searchParams.set('labelId', input.labelId);
    url.searchParams.set('maxResults', String(GMAIL_PAGE_SIZE));
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const response = await input.fetchImpl(url.toString(), {
      headers: buildGmailHeaders({ accessToken: input.accessToken }),
    });
    if (response.status === 404) {
      throw connectorCursorExpiredError({
        message: 'Gmail history cursor expired; bounded selected-label resync required',
        statusCode: 404,
      });
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw connectorRateLimitError({
          message: `Gmail history.list failed: HTTP ${response.status}`,
        });
      }
      throw new Error(`Gmail history.list failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as GmailHistoryResponse;
    history.push(...(payload.history ?? []));
    latestHistoryId = maxGmailHistoryId(latestHistoryId, payload.historyId ?? null);
    pageToken =
      typeof payload.nextPageToken === 'string' && payload.nextPageToken.length > 0
        ? payload.nextPageToken
        : null;
  } while (pageToken);
  return {
    history,
    latestHistoryId,
  };
}

async function loadSelectedGmailMessage(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  messageId: string;
  selectedLabels: GmailSelectedLabel[];
  hintedSelectedLabelIds?: Iterable<string>;
  preferredMode?: GmailStorageMode | null;
}): Promise<
  | { status: 'missing' }
  | { status: 'out_of_scope'; message: GmailMessage }
  | { status: 'active'; message: GmailMessage }
> {
  const initialFormat =
    input.preferredMode === 'indexed' ||
    [...(input.hintedSelectedLabelIds ?? [])].some((labelId) =>
      input.selectedLabels.some(
        (label) => label.externalId === labelId && label.storageMode === 'indexed',
      ),
    )
      ? 'full'
      : 'metadata';
  let message = await fetchGmailMessage({
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    messageId: input.messageId,
    format: initialFormat,
  });
  if (!message) return { status: 'missing' };
  let rawObject = buildActiveGmailMessage({
    message,
    selectedLabels: input.selectedLabels,
    hintedSelectedLabelIds: input.hintedSelectedLabelIds,
    mode: 'vault',
  });
  if (!rawObject) {
    return {
      status: 'out_of_scope',
      message: {
        ...message,
        __mode: 'vault',
        deleted: false,
        changeState: 'active',
        storageMode: 'reference',
        selectedLabelIds: [],
        bodyText: null,
      },
    };
  }
  if (rawObject.storageMode === 'indexed' && initialFormat === 'metadata') {
    message = await fetchGmailMessage({
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      messageId: input.messageId,
      format: 'full',
    });
    if (!message) return { status: 'missing' };
    rawObject = buildActiveGmailMessage({
      message,
      selectedLabels: input.selectedLabels,
      hintedSelectedLabelIds: input.hintedSelectedLabelIds,
      mode: 'vault',
    });
    if (!rawObject) {
      return {
        status: 'out_of_scope',
        message: {
          ...message,
          __mode: 'vault',
          deleted: false,
          changeState: 'active',
          storageMode: 'reference',
          selectedLabelIds: [],
          bodyText: null,
        },
      };
    }
  }
  return { status: 'active', message: rawObject };
}

async function runSelectedLabelInitialSync(input: {
  context: ConnectorSyncContext;
  accessToken: string | null;
  pullMode: 'stub' | 'vault';
  selectedLabels: GmailSelectedLabel[];
  previousState: GmailCursorState;
  reason: string;
  reusePreviousStartHistoryId?: boolean;
}): Promise<ConnectorSyncPage<GmailMessage>> {
  if (input.pullMode === 'stub' || !input.accessToken) {
    const rawObjects = buildStubGmailMessages({
      connectionId: input.context.account.connectionId,
      metadata: input.context.account.metadata,
    });
    const knownMessages = rawObjects
      .map((rawObject) => buildKnownGmailMessage(rawObject))
      .filter((entry): entry is GmailKnownMessage => entry !== null);
    return {
      stream: GMAIL_CURSOR_STREAM,
      mode: 'initial',
      rawObjects,
      pullMode: 'stub',
      note: input.reason,
      nextCursor: buildGmailCursor({
        startHistoryId: rawObjects[0]?.historyId ?? null,
        selectedLabels: input.selectedLabels,
        knownMessages,
      }),
    };
  }

  const fetchImpl = input.context.fetchImpl ?? fetch;
  const hintedLabelIdsByMessageId = new Map<string, Set<string>>();
  for (const label of input.selectedLabels) {
    const ids = await listGmailMessageIdsForLabel({
      accessToken: input.accessToken,
      fetchImpl,
      labelId: label.externalId,
    });
    for (const messageId of ids) {
      const existing = hintedLabelIdsByMessageId.get(messageId) ?? new Set<string>();
      existing.add(label.externalId);
      hintedLabelIdsByMessageId.set(messageId, existing);
    }
  }

  const knownMessages = new Map<string, GmailKnownMessage>();
  const rawObjects: GmailMessage[] = [];
  let startHistoryId: string | null = null;
  for (const [messageId, hintedLabelIds] of hintedLabelIdsByMessageId.entries()) {
    const loaded = await loadSelectedGmailMessage({
      accessToken: input.accessToken,
      fetchImpl,
      messageId,
      selectedLabels: input.selectedLabels,
      hintedSelectedLabelIds: hintedLabelIds,
    });
    if (loaded.status !== 'active') continue;
    const rawObject = loaded.message;
    rawObjects.push(rawObject);
    const known = buildKnownGmailMessage(rawObject);
    if (known) {
      knownMessages.set(known.id, known);
    }
    startHistoryId = maxGmailHistoryId(startHistoryId, rawObject.historyId ?? null);
  }

  const observedAt = new Date().toISOString();
  for (const previousKnown of input.previousState.knownMessages) {
    if (knownMessages.has(previousKnown.id)) continue;
    rawObjects.push(
      buildGmailTombstone({
        messageId: previousKnown.id,
        observedAt,
        collectionId: previousKnown.collectionId,
        storageMode: previousKnown.storageMode,
        title: previousKnown.title,
        selectedLabelIds: previousKnown.selectedLabelIds,
        changeState: 'missing_from_selected_resync',
        historyId: startHistoryId,
      }),
    );
  }

  rawObjects.sort(
    (left, right) =>
      sanitizeObservedAt(right.internalDate).localeCompare(sanitizeObservedAt(left.internalDate)),
  );
  return {
    stream: GMAIL_CURSOR_STREAM,
    mode: 'initial',
    rawObjects,
    pullMode: 'vault',
    note: input.reason,
    nextCursor: buildGmailCursor({
      startHistoryId:
        startHistoryId ??
        (input.reusePreviousStartHistoryId === false
          ? null
          : input.previousState.startHistoryId),
      selectedLabels: input.selectedLabels,
      knownMessages: knownMessages.values(),
    }),
  };
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
  const selectedLabels = resolveGmailSelectedLabels(context.account.metadata);
  const previousState = parseGmailCursorState(context.cursor);
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (
    mode === 'initial' ||
    previousState.startHistoryId === null ||
    previousState.scopeKey !== buildGmailScopeKey(selectedLabels)
  ) {
    return runSelectedLabelInitialSync({
      context,
      accessToken: creds.mode === 'stub' ? null : creds.accessToken,
      pullMode: creds.mode === 'stub' ? 'stub' : 'vault',
      selectedLabels,
      previousState,
      reason:
        creds.mode === 'stub'
          ? 'synthetic Gmail selected-label sync; vault credentials not read'
          : previousState.scopeKey && previousState.scopeKey !== buildGmailScopeKey(selectedLabels)
            ? 'bounded Gmail selected-label resync after label selection change'
            : 'Gmail selected-label initial sync',
    });
  }

  if (creds.mode === 'stub') {
    return {
      stream: GMAIL_CURSOR_STREAM,
      mode: 'incremental',
      rawObjects: [],
      pullMode: 'stub',
      note: 'synthetic Gmail incremental sync found no selected-label changes',
      nextCursor: context.cursor ?? null,
    };
  }

  const fetchImpl = context.fetchImpl ?? fetch;
  const previousKnownMessages = new Map(
    previousState.knownMessages.map((entry) => [entry.id, entry]),
  );
  const nextKnownMessages = new Map(previousKnownMessages);
  const rawObjects: GmailMessage[] = [];
  const changedMessageIds = new Set<string>();
  const hintedLabelIdsByMessageId = new Map<string, Set<string>>();
  let nextHistoryId: string | null = previousState.startHistoryId;

  try {
    for (const label of selectedLabels) {
      const historyResult = await listGmailHistorySince({
        accessToken: creds.accessToken,
        fetchImpl,
        startHistoryId: previousState.startHistoryId,
        labelId: label.externalId,
      });
      nextHistoryId = maxGmailHistoryId(nextHistoryId, historyResult.latestHistoryId);
      for (const entry of historyResult.history) {
        for (const added of entry.messagesAdded ?? []) {
          const messageId = added.message?.id?.trim();
          if (!messageId) continue;
          changedMessageIds.add(messageId);
          const hinted = hintedLabelIdsByMessageId.get(messageId) ?? new Set<string>();
          hinted.add(label.externalId);
          hintedLabelIdsByMessageId.set(messageId, hinted);
        }
        for (const labelsAdded of entry.labelsAdded ?? []) {
          const messageId = labelsAdded.message?.id?.trim();
          if (!messageId) continue;
          changedMessageIds.add(messageId);
          const hinted = hintedLabelIdsByMessageId.get(messageId) ?? new Set<string>();
          hinted.add(label.externalId);
          for (const labelId of labelsAdded.labelIds ?? []) {
            hinted.add(labelId);
          }
          hintedLabelIdsByMessageId.set(messageId, hinted);
        }
        for (const labelsRemoved of entry.labelsRemoved ?? []) {
          const messageId = labelsRemoved.message?.id?.trim();
          if (!messageId) continue;
          changedMessageIds.add(messageId);
          const hinted = hintedLabelIdsByMessageId.get(messageId) ?? new Set<string>();
          hinted.add(label.externalId);
          hintedLabelIdsByMessageId.set(messageId, hinted);
        }
        for (const deleted of entry.messagesDeleted ?? []) {
          const messageId = deleted.message?.id?.trim();
          if (!messageId) continue;
          const previousKnown = previousKnownMessages.get(messageId);
          if (!previousKnown) continue;
          rawObjects.push(
            buildGmailTombstone({
              messageId,
              observedAt: new Date().toISOString(),
              collectionId: previousKnown.collectionId,
              storageMode: previousKnown.storageMode,
              title: previousKnown.title,
              selectedLabelIds: previousKnown.selectedLabelIds,
              changeState: 'deleted',
              historyId: entry.id ?? historyResult.latestHistoryId,
            }),
          );
          nextKnownMessages.delete(messageId);
          changedMessageIds.delete(messageId);
        }
      }
    }
  } catch (error) {
    const classified = classifyConnectorError(error);
    if (classified.kind !== 'cursor_expired') {
      throw error;
    }
    return runSelectedLabelInitialSync({
      context,
      accessToken: creds.accessToken,
      pullMode: 'vault',
      selectedLabels,
      previousState,
      reason: 'bounded Gmail selected-label resync after expired history cursor',
      reusePreviousStartHistoryId: false,
    });
  }

  for (const messageId of changedMessageIds) {
    const hintedSelectedLabelIds = hintedLabelIdsByMessageId.get(messageId) ?? new Set<string>();
    const previousKnown = previousKnownMessages.get(messageId) ?? null;
    const loaded = await loadSelectedGmailMessage({
      accessToken: creds.accessToken,
      fetchImpl,
      messageId,
      selectedLabels,
      hintedSelectedLabelIds,
      preferredMode: previousKnown?.storageMode ?? null,
    });
    if (loaded.status === 'missing') {
      if (!previousKnown) continue;
      rawObjects.push(
        buildGmailTombstone({
          messageId,
          observedAt: new Date().toISOString(),
          collectionId: previousKnown.collectionId,
          storageMode: previousKnown.storageMode,
          title: previousKnown.title,
          selectedLabelIds: previousKnown.selectedLabelIds,
          changeState: 'deleted',
          historyId: nextHistoryId,
        }),
      );
      nextKnownMessages.delete(messageId);
      continue;
    }
    if (loaded.status === 'out_of_scope') {
      if (!previousKnown) continue;
      rawObjects.push(
        buildGmailTombstone({
          messageId,
          observedAt: sanitizeObservedAt(loaded.message.internalDate),
          collectionId: previousKnown.collectionId,
          storageMode: previousKnown.storageMode,
          title: previousKnown.title,
          selectedLabelIds: previousKnown.selectedLabelIds,
          changeState: 'label_removed',
          historyId: loaded.message.historyId ?? nextHistoryId,
        }),
      );
      nextKnownMessages.delete(messageId);
      continue;
    }
    const rawObject = loaded.message;
    nextHistoryId = maxGmailHistoryId(nextHistoryId, rawObject.historyId ?? null);
    if ((rawObject.selectedLabelIds ?? []).length === 0) {
      if (!previousKnown) continue;
      rawObjects.push(
        buildGmailTombstone({
          messageId,
          observedAt: sanitizeObservedAt(rawObject.internalDate),
          collectionId: previousKnown.collectionId,
          storageMode: previousKnown.storageMode,
          title: previousKnown.title,
          selectedLabelIds: previousKnown.selectedLabelIds,
          changeState: 'label_removed',
          historyId: rawObject.historyId ?? nextHistoryId,
        }),
      );
      nextKnownMessages.delete(messageId);
      continue;
    }
    rawObjects.push(rawObject);
    const known = buildKnownGmailMessage(rawObject);
    if (known) {
      nextKnownMessages.set(known.id, known);
    }
  }

  rawObjects.sort(
    (left, right) =>
      sanitizeObservedAt(right.internalDate).localeCompare(sanitizeObservedAt(left.internalDate)),
  );
  return {
    stream: GMAIL_CURSOR_STREAM,
    mode: 'incremental',
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'Gmail history.list incremental sync captured selected-label deltas'
        : 'Gmail history.list found no selected-label changes',
    nextCursor: buildGmailCursor({
      startHistoryId: nextHistoryId,
      selectedLabels,
      knownMessages: nextKnownMessages.values(),
    }),
  };
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
  const observedAt = sanitizeObservedAt(input.message.internalDate);
  const sourceMode = input.message.__mode ?? 'vault';
  const storageMode = normalizeGmailStorageMode(input.message.storageMode);
  const changeState = input.message.changeState ?? 'active';
  const eventVersion = input.message.deleted
    ? `${changeState}:${input.message.historyId ?? observedAt}`
    : input.message.historyId ?? input.message.internalDate ?? observedAt;
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}/${eventVersion}`;
  const eventType = input.message.deleted
    ? `gmail.message.${changeState}`
    : 'gmail.message.updated';
  const selectedLabelIds = input.message.selectedLabelIds ?? [];
  const bodyText =
    storageMode === 'indexed' && typeof input.message.bodyText === 'string'
      ? input.message.bodyText.trim()
      : '';
  const object: ExternalObject = {
    provider: 'gmail',
    accountId: input.connectionId,
    collectionId: input.message.collectionId,
    externalId,
    externalVersion: eventVersion,
    objectType: 'message',
    title: subject,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: input.message.deleted ?? false,
    attachments: [],
    permissionsSnapshot: {},
    metadata: {
      from,
      snippet: input.message.snippet ?? null,
      selectedLabelIds,
      sourceMode,
      changeState,
      bodyIncluded: storageMode === 'indexed' && bodyText.length > 0,
    },
  };
  const note = input.message.deleted
    ? 'Gmail message left the selected labels or was deleted.'
    : sourceMode === 'stub'
      ? 'Synthetic Gmail selected-label sync (vault credentials not read).'
      : storageMode === 'indexed'
        ? 'Source: vault-backed Gmail selected-label sync with indexed body.'
        : 'Source: vault-backed Gmail selected-label metadata sync.';
  const captureLines = [
    `Connector: Gmail (${sourceMode})`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `Selected labels: ${selectedLabelIds.join(', ') || 'none'}`,
    `State: ${changeState}`,
    storageMode === 'indexed'
      ? bodyText || input.message.snippet || 'Indexed label selected, but no plain-text body was available.'
      : input.message.snippet
        ? `Snippet: ${input.message.snippet}`
        : 'Metadata-only Gmail pull (no full body stored).',
    note,
  ];
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'gmail',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: eventVersion,
      },
      event_type: eventType,
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        text: `${label}: ${subject}`,
      },
      scope: {
        sensitivity: 'personal',
        storage_mode: storageMode,
      },
      provenance: {
        from,
        sourceMode,
        changeState,
        selectedLabelIds,
      },
    },
    capture: {
      title: `${label}: ${subject}`,
      text: captureLines.join('\n'),
      filename: `gmail://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

async function checkpointGmailMessages(input: {
  page: ConnectorSyncPage<GmailMessage>;
  records: NormalizedConnectorRecord[];
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const nextCursor = input.page.nextCursor ?? input.previousCursor;
  if (!nextCursor) return null;
  const nextState = parseGmailCursorState(nextCursor);
  const knownMessages = new Map(nextState.knownMessages.map((entry) => [entry.id, entry]));
  for (const record of input.records) {
    const messageId = parseGmailMessageExternalId(record.externalObject.externalId);
    if (record.externalObject.deleted) {
      knownMessages.delete(messageId);
      continue;
    }
    knownMessages.set(messageId, {
      id: messageId,
      collectionId: record.externalObject.collectionId ?? 'gmail:unknown',
      storageMode: normalizeGmailStorageMode(record.envelope.scope.storage_mode),
      title: record.externalObject.title ?? null,
      selectedLabelIds: Array.isArray(record.externalObject.metadata.selectedLabelIds)
        ? record.externalObject.metadata.selectedLabelIds.filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : [],
    });
  }
  return buildDefaultCursor(
    GMAIL_CURSOR_STREAM,
    {
      startHistoryId: nextState.startHistoryId,
      scopeKey: nextState.scopeKey,
      knownMessages: [...knownMessages.values()],
    },
    nextCursor.schemaVersion,
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
  const scopeValidation = validateGmailSelectionScope(context.account.metadata);
  if (!scopeValidation.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'gmail',
      status: 'degraded',
      note: `Gmail selected scope missing: ${scopeValidation.missing.join(', ')}`,
      vaultRef,
      checks: [
        {
          name: 'selected_scope',
          status: 'fail',
          detail: `Missing selected Gmail labels: ${scopeValidation.missing.join(', ')}`,
        },
      ],
    });
  }

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
        : 'Gmail remains in explicit selected-label stub mode for local certification.',
      vaultRef,
      checks: [
        {
          name: hasVaultRef ? 'oauth_token' : 'stub_mode',
          status: hasVaultRef ? 'fail' : 'warn',
          detail: hasVaultRef
            ? 'Vault token missing; Gmail requires OAuth reconnect.'
            : 'Gmail selected-label sync is intentionally running in stub mode.',
        },
      ],
    });
  }

  const probeLabel = resolveGmailSelectedLabels(context.account.metadata)[0]!;
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('labelIds', probeLabel.externalId);
  url.searchParams.set('maxResults', '1');
  const response = await (context.fetchImpl ?? fetch)(url.toString(), {
    headers: buildGmailHeaders({ accessToken: creds.accessToken }),
  });
  if (response.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'gmail',
      status: 'healthy',
      note: `Gmail OAuth token is valid and the selected-label probe for ${probeLabel.title} succeeded`,
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
          detail: `Gmail selected-label probe returned HTTP 200 for ${probeLabel.externalId}.`,
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
          detail: `Gmail selected-label probe returned HTTP ${response.status}.`,
        },
      ],
    });
  }
  return buildConnectionHealthReport({
    connectionId: context.account.connectionId,
    connectorId: 'gmail',
    status: 'degraded',
    note: `Gmail selected-label probe failed with HTTP ${response.status}`,
    vaultRef,
    checks: [
      {
        name: 'provider_probe',
        status: 'warn',
        detail: `Gmail selected-label probe returned HTTP ${response.status}.`,
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
    capabilities: ['messages.metadata', 'messages.body', 'labels.read'],
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
    data_classes: ['personal'],
  },
  lifecycle: {
    async validateScope(context) {
      return validateGmailSelectionScope(context.account.metadata);
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
    async checkpoint({ page, records, previousCursor }) {
      return checkpointGmailMessages({ page, records, previousCursor });
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
  certification: {
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
    buildCursorExpiredContext({ baseContext, initialRun }) {
      return {
        ...baseContext,
        cursor: buildDefaultCursor(
          GMAIL_CURSOR_STREAM,
          {
            ...parseGmailCursorState(initialRun.nextCursor),
            startHistoryId: 'expired-history-id',
            scopeKey: buildGmailScopeKey(resolveGmailSelectedLabels(baseContext.account.metadata)),
          },
          GMAIL_CURSOR_SCHEMA_VERSION,
        ),
      };
    },
    buildRevokeContext(context) {
      return {
        ...context,
        account: {
          ...context.account,
          vaultRef: context.account.vaultRef ?? 'vault:test/gmail',
        },
      };
    },
  },
};

/** Stub Gmail delta: invents selected-label message events from vault ref only. */
export function pullGmailStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  metadata?: Record<string, unknown>;
}): GmailPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'gmail',
      accountId: input.connectionId,
    });
  const rawObjects = buildStubGmailMessages({
    connectionId: input.connectionId,
    metadata: input.metadata,
  });
  const items = rawObjects.map((message) => {
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
  const knownMessages = rawObjects
    .map((rawObject) => buildKnownGmailMessage(rawObject))
    .filter((entry): entry is GmailKnownMessage => entry !== null);
  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Gmail selected-label sync; vault credentials not read',
    items,
    nextCursor: buildGmailCursor({
      startHistoryId: rawObjects[0]?.historyId ?? null,
      selectedLabels: resolveGmailSelectedLabels(input.metadata),
      knownMessages,
    }),
  };
}

/** Pull Gmail deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGmailDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
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
        metadata: input.metadata,
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

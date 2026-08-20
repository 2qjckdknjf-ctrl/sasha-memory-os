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

type DriveStorageMode = 'reference' | 'indexed' | 'archived';

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  parents?: string[];
  trashed?: boolean;
  __mode?: 'stub' | 'vault';
};

type DriveRawObject = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  observedAt: string;
  parents: string[];
  deleted?: boolean;
  collectionId?: string;
  storageMode?: DriveStorageMode;
  permissions?: Record<string, unknown>;
  changeState?:
    | 'active'
    | 'removed'
    | 'permission_lost'
    | 'moved_out_of_scope'
    | 'missing_from_scope_resync';
  __mode?: 'stub' | 'vault';
};

type DriveListResponse = {
  files?: DriveFile[];
  nextPageToken?: string;
};

type DriveChangesResponse = {
  changes?: Array<{
    fileId?: string;
    removed?: boolean;
    time?: string;
    file?: DriveFile;
  }>;
  nextPageToken?: string;
  newStartPageToken?: string;
};

type DriveStartPageTokenResponse = {
  startPageToken?: string;
};

type DriveSelectedRoot = {
  collectionId: string;
  externalId: string;
  kind: 'file' | 'folder';
  name: string;
  title: string;
  storageMode: DriveStorageMode;
};

type DriveKnownFile = {
  id: string;
  collectionId: string;
  storageMode: DriveStorageMode;
  title?: string | null;
};

type DriveKnownFolder = {
  id: string;
  collectionId: string;
  storageMode: DriveStorageMode;
};

type DriveCursorState = {
  startPageToken: string | null;
  scopeKey: string | null;
  knownFiles: DriveKnownFile[];
  knownFolders: DriveKnownFolder[];
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DRIVE_CURSOR_STREAM = 'google-drive:files';
const DRIVE_CURSOR_SCHEMA_VERSION = '2.0';
const DRIVE_PAGE_SIZE = 5;
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime,parents,trashed';
const DRIVE_RESTRICTED_SCOPE = 'drive.file';

function labelForDriveAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Google Drive';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDriveStorageMode(
  value: unknown,
  fallback: DriveStorageMode = 'reference',
): DriveStorageMode {
  return value === 'indexed' || value === 'archived' || value === 'reference' ? value : fallback;
}

function isDriveFolder(file: {
  mimeType?: string;
}): boolean {
  return file.mimeType === DRIVE_FOLDER_MIME;
}

function driveFileExternalId(fileId: string): string {
  return `file/${fileId}`;
}

function sanitizeObservedAt(value: string | undefined, fallback = new Date().toISOString()): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function parseDriveCursorState(cursor: SyncCursor | null | undefined): DriveCursorState {
  const knownFiles = Array.isArray(cursor?.opaque?.knownFiles)
    ? cursor.opaque.knownFiles.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const collectionId = typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
        if (!id || !collectionId) return [];
        return [
          {
            id,
            collectionId,
            storageMode: normalizeDriveStorageMode(entry.storageMode),
            title: typeof entry.title === 'string' ? entry.title : null,
          } satisfies DriveKnownFile,
        ];
      })
    : [];
  const knownFolders = Array.isArray(cursor?.opaque?.knownFolders)
    ? cursor.opaque.knownFolders.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const collectionId = typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
        if (!id || !collectionId) return [];
        return [
          {
            id,
            collectionId,
            storageMode: normalizeDriveStorageMode(entry.storageMode, 'reference'),
          } satisfies DriveKnownFolder,
        ];
      })
    : [];
  return {
    startPageToken:
      typeof cursor?.opaque?.startPageToken === 'string' ? cursor.opaque.startPageToken : null,
    scopeKey: typeof cursor?.opaque?.scopeKey === 'string' ? cursor.opaque.scopeKey : null,
    knownFiles,
    knownFolders,
  };
}

export function resolveGoogleDriveSelectedRoots(metadata: unknown): DriveSelectedRoot[] {
  if (!isPlainObject(metadata)) return [];
  const collections = metadata.collections;
  if (!isPlainObject(collections)) return [];
  if (collections.selection_mode !== 'selected') return [];
  const rawItems = Array.isArray(collections.items) ? collections.items : [];
  return rawItems.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const kind = item.kind;
    const externalId = typeof item.external_id === 'string' ? item.external_id.trim() : '';
    const collectionId = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (
      (kind !== 'file' && kind !== 'folder') ||
      externalId.length === 0 ||
      collectionId.length === 0 ||
      name.length === 0
    ) {
      return [];
    }
    const itemMetadata = isPlainObject(item.metadata) ? item.metadata : {};
    return [
      {
        collectionId,
        externalId,
        kind,
        name,
        title:
          typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : name,
        storageMode: normalizeDriveStorageMode(itemMetadata.storage_mode),
      } satisfies DriveSelectedRoot,
    ];
  });
}

export function validateGoogleDriveSelectionScope(metadata: unknown): {
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
  if (resolveGoogleDriveSelectedRoots(metadata).length === 0) {
    missing.push('selected Google Drive files/folders');
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

function buildDriveScopeKey(roots: DriveSelectedRoot[]): string {
  return roots
    .map((root) => `${root.collectionId}:${root.kind}:${root.externalId}:${root.storageMode}`)
    .sort()
    .join('|');
}

function findScopeTargetForDriveFile(input: {
  file: DriveFile;
  selectedRoots: DriveSelectedRoot[];
  knownFiles?: DriveKnownFile[];
  knownFolders?: DriveKnownFolder[];
}):
  | {
      status: 'in_scope';
      collectionId: string;
      storageMode: DriveStorageMode;
      relation: 'selected_file' | 'folder_descendant';
    }
  | {
      status: 'known_out_of_scope';
      collectionId: string;
      storageMode: DriveStorageMode;
      relation: 'known_scope_exit';
    }
  | { status: 'out_of_scope' } {
  const fileId = typeof input.file.id === 'string' ? input.file.id.trim() : '';
  if (!fileId) return { status: 'out_of_scope' };
  const exactSelected = input.selectedRoots.find(
    (root) => root.kind === 'file' && root.externalId === fileId,
  );
  if (exactSelected) {
    return {
      status: 'in_scope',
      collectionId: exactSelected.collectionId,
      storageMode: exactSelected.storageMode,
      relation: 'selected_file',
    };
  }

  const folderCollections = new Map<
    string,
    { collectionId: string; storageMode: DriveStorageMode }
  >(
    input.selectedRoots
      .filter((root) => root.kind === 'folder')
      .map((root) => [
        root.externalId,
        {
          collectionId: root.collectionId,
          storageMode: root.storageMode === 'archived' ? 'archived' : 'reference',
        },
      ]),
  );
  for (const folder of input.knownFolders ?? []) {
    folderCollections.set(folder.id, {
      collectionId: folder.collectionId,
      storageMode: folder.storageMode === 'archived' ? 'archived' : 'reference',
    });
  }

  for (const parentId of input.file.parents ?? []) {
    const matchedFolder = folderCollections.get(parentId);
    if (matchedFolder) {
      return {
        status: 'in_scope',
        collectionId: matchedFolder.collectionId,
        storageMode: matchedFolder.storageMode,
        relation: 'folder_descendant',
      };
    }
  }

  const previousFile = (input.knownFiles ?? []).find((entry) => entry.id === fileId);
  if (previousFile) {
    return {
      status: 'known_out_of_scope',
      collectionId: previousFile.collectionId,
      storageMode: previousFile.storageMode,
      relation: 'known_scope_exit',
    };
  }

  return { status: 'out_of_scope' };
}

export function driveFileWithinSelectedScope(input: {
  file: Pick<DriveFile, 'id' | 'parents'>;
  metadata: unknown;
  knownFiles?: DriveKnownFile[];
  knownFolders?: DriveKnownFolder[];
}): boolean {
  return (
    findScopeTargetForDriveFile({
      file: input.file,
      selectedRoots: resolveGoogleDriveSelectedRoots(input.metadata),
      knownFiles: input.knownFiles,
      knownFolders: input.knownFolders,
    }).status === 'in_scope'
  );
}

function buildStubDriveObjects(metadata: unknown): DriveRawObject[] {
  const selectedRoots = resolveGoogleDriveSelectedRoots(metadata);
  const selectedFile = selectedRoots.find((root) => root.kind === 'file');
  if (selectedFile) {
    return [
      {
        id: selectedFile.externalId,
        name: selectedFile.title,
        mimeType: 'text/markdown',
        modifiedTime: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        parents: [],
        collectionId: selectedFile.collectionId,
        storageMode: selectedFile.storageMode,
        changeState: 'active',
        __mode: 'stub',
      },
    ];
  }
  const selectedFolder = selectedRoots.find((root) => root.kind === 'folder');
  if (!selectedFolder) return [];
  const observedAt = new Date().toISOString();
  return [
    {
      id: `stub-${selectedFolder.externalId}-child`,
      name: `${selectedFolder.title} brief.docx`,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      modifiedTime: observedAt,
      observedAt,
      parents: [selectedFolder.externalId],
      collectionId: selectedFolder.collectionId,
      storageMode: selectedFolder.storageMode === 'archived' ? 'archived' : 'reference',
      changeState: 'active',
      __mode: 'stub',
    },
  ];
}

function buildDriveCursor(input: {
  startPageToken: string | null;
  selectedRoots: DriveSelectedRoot[];
  knownFiles: Iterable<DriveKnownFile>;
  knownFolders: Iterable<DriveKnownFolder>;
}): SyncCursor {
  return buildDefaultCursor(
    DRIVE_CURSOR_STREAM,
    {
      startPageToken: input.startPageToken,
      scopeKey: buildDriveScopeKey(input.selectedRoots),
      knownFiles: [...input.knownFiles],
      knownFolders: [...input.knownFolders],
    },
    DRIVE_CURSOR_SCHEMA_VERSION,
  );
}

function buildActiveDriveObject(input: {
  file: DriveFile;
  collectionId: string;
  storageMode: DriveStorageMode;
}): DriveRawObject {
  const observedAt = sanitizeObservedAt(input.file.modifiedTime);
  return {
    id: String(input.file.id),
    name: input.file.name,
    mimeType: input.file.mimeType,
    modifiedTime: input.file.modifiedTime ?? observedAt,
    observedAt,
    parents: input.file.parents ?? [],
    collectionId: input.collectionId,
    storageMode: input.storageMode,
    permissions: {
      access: 'granted',
    },
    changeState: 'active',
    __mode: input.file.__mode ?? 'vault',
  };
}

function buildDriveTombstone(input: {
  fileId: string;
  observedAt: string;
  collectionId: string;
  storageMode: DriveStorageMode;
  title?: string | null;
  changeState: Exclude<DriveRawObject['changeState'], 'active'>;
}): DriveRawObject {
  return {
    id: input.fileId,
    name: input.title ?? 'Google Drive item',
    mimeType: 'application/octet-stream',
    modifiedTime: input.observedAt,
    observedAt: input.observedAt,
    parents: [],
    deleted: true,
    collectionId: input.collectionId,
    storageMode: input.storageMode,
    permissions: {
      access: 'revoked',
      reason: input.changeState,
    },
    changeState: input.changeState,
    __mode: 'vault',
  };
}

function buildKnownFileFromRawObject(rawObject: DriveRawObject): DriveKnownFile {
  return {
    id: rawObject.id,
    collectionId: rawObject.collectionId ?? 'google-drive:unknown',
    storageMode: normalizeDriveStorageMode(rawObject.storageMode),
    title: rawObject.name ?? null,
  };
}

async function parseDriveErrorText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function assertDriveResponseOk(input: {
  response: Response;
  errorText?: string;
  action: string;
}): void {
  if (input.response.ok) return;
  if (input.response.status === 429) {
    throw connectorRateLimitError({
      message: `Google Drive ${input.action} failed: HTTP ${input.response.status}`,
    });
  }
  throw new Error(
    `Google Drive ${input.action} failed: HTTP ${input.response.status}${
      input.errorText ? ` ${input.errorText}` : ''
    }`,
  );
}

function isExpiredDrivePageToken(input: {
  response: Response;
  errorText: string;
}): boolean {
  if (input.response.status === 410) return true;
  if (input.response.status !== 400) return false;
  return /page.?token|start page token|expired/i.test(input.errorText);
}

async function requestDriveStartPageToken(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const response = await input.fetchImpl(
    'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true',
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  const errorText = response.ok ? '' : await parseDriveErrorText(response);
  assertDriveResponseOk({
    response,
    errorText,
    action: 'changes.getStartPageToken',
  });
  const payload = (await response.json()) as DriveStartPageTokenResponse;
  if (!payload.startPageToken) {
    throw new Error('Google Drive changes.getStartPageToken returned no startPageToken');
  }
  return payload.startPageToken;
}

async function getDriveFileById(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  fileId: string;
}): Promise<DriveFile | null> {
  const response = await input.fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.fileId,
    )}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (response.status === 403 || response.status === 404) {
    return null;
  }
  const errorText = response.ok ? '' : await parseDriveErrorText(response);
  assertDriveResponseOk({
    response,
    errorText,
    action: 'files.get',
  });
  return ((await response.json()) as DriveFile) ?? null;
}

async function listDriveChildren(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  parentId: string;
}): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | null = null;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', String(DRIVE_PAGE_SIZE));
    url.searchParams.set(
      'q',
      `'${input.parentId.replace(/'/g, "\\'")}' in parents and trashed = false`,
    );
    url.searchParams.set('fields', `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const response = await input.fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    });
    const errorText = response.ok ? '' : await parseDriveErrorText(response);
    assertDriveResponseOk({
      response,
      errorText,
      action: 'files.list',
    });
    const payload = (await response.json()) as DriveListResponse;
    files.push(
      ...(payload.files ?? [])
        .filter((file): file is DriveFile & { id: string } => typeof file.id === 'string')
        .map((file) => ({ ...file, __mode: 'vault' as const })),
    );
    pageToken = payload.nextPageToken ?? null;
  } while (pageToken);
  return files;
}

async function listDriveChangesSinceToken(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  startPageToken: string;
}): Promise<{
  changes: NonNullable<DriveChangesResponse['changes']>;
  newStartPageToken: string;
}> {
  const changes: NonNullable<DriveChangesResponse['changes']> = [];
  let pageToken: string | null = input.startPageToken;
  let newStartPageToken: string | null = null;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/changes');
    url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('pageSize', String(DRIVE_PAGE_SIZE));
    url.searchParams.set('fields', `nextPageToken,newStartPageToken,changes(fileId,removed,time,file(${DRIVE_FILE_FIELDS}))`);
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    const response = await input.fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    });
    const errorText = response.ok ? '' : await parseDriveErrorText(response);
    if (isExpiredDrivePageToken({ response, errorText })) {
      throw connectorCursorExpiredError({
        message: 'Google Drive start page token expired; bounded selected-scope resync required',
      });
    }
    assertDriveResponseOk({
      response,
      errorText,
      action: 'changes.list',
    });
    const payload = (await response.json()) as DriveChangesResponse;
    changes.push(...(payload.changes ?? []));
    newStartPageToken = payload.newStartPageToken ?? newStartPageToken;
    pageToken = payload.nextPageToken ?? null;
  } while (pageToken);
  return {
    changes,
    newStartPageToken: newStartPageToken ?? input.startPageToken,
  };
}

async function walkSelectedDriveScope(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  selectedRoots: DriveSelectedRoot[];
}): Promise<{
  rawObjects: DriveRawObject[];
  knownFiles: Map<string, DriveKnownFile>;
  knownFolders: Map<string, DriveKnownFolder>;
}> {
  const rawObjects: DriveRawObject[] = [];
  const knownFiles = new Map<string, DriveKnownFile>();
  const knownFolders = new Map<string, DriveKnownFolder>();

  const queue: Array<{
    folderId: string;
    collectionId: string;
    storageMode: DriveStorageMode;
  }> = input.selectedRoots
    .filter((root) => root.kind === 'folder')
    .map((root) => {
      const storageMode = root.storageMode === 'archived' ? 'archived' : 'reference';
      knownFolders.set(root.externalId, {
        id: root.externalId,
        collectionId: root.collectionId,
        storageMode,
      });
      return {
        folderId: root.externalId,
        collectionId: root.collectionId,
        storageMode,
      };
    });

  for (const root of input.selectedRoots.filter((entry) => entry.kind === 'file')) {
    const file = await getDriveFileById({
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      fileId: root.externalId,
    });
    if (!file || !file.id || file.trashed) continue;
    const rawObject = buildActiveDriveObject({
      file: file,
      collectionId: root.collectionId,
      storageMode: root.storageMode,
    });
    rawObjects.push(rawObject);
    knownFiles.set(file.id, buildKnownFileFromRawObject(rawObject));
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const children = await listDriveChildren({
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      parentId: current.folderId,
    });
    for (const child of children) {
      if (!child.id || child.trashed) continue;
      if (isDriveFolder(child)) {
        knownFolders.set(child.id, {
          id: child.id,
          collectionId: current.collectionId,
          storageMode: current.storageMode,
        });
        queue.push({
          folderId: child.id,
          collectionId: current.collectionId,
          storageMode: current.storageMode,
        });
        continue;
      }
      const rawObject = buildActiveDriveObject({
        file: child,
        collectionId: current.collectionId,
        storageMode: current.storageMode,
      });
      rawObjects.push(rawObject);
      knownFiles.set(child.id, buildKnownFileFromRawObject(rawObject));
    }
  }

  rawObjects.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  return {
    rawObjects,
    knownFiles,
    knownFolders,
  };
}

async function runSelectedScopeInitialSync(input: {
  context: ConnectorSyncContext;
  accessToken: string | null;
  pullMode: 'stub' | 'vault';
  selectedRoots: DriveSelectedRoot[];
  previousState?: DriveCursorState | null;
  reason: string;
}): Promise<ConnectorSyncPage<DriveRawObject>> {
  if (input.pullMode === 'stub' || !input.accessToken) {
    const rawObjects = buildStubDriveObjects(input.context.account.metadata);
    const knownFiles = new Map(rawObjects.map((item) => [item.id, buildKnownFileFromRawObject(item)]));
    return {
      stream: DRIVE_CURSOR_STREAM,
      mode: 'initial',
      rawObjects,
      pullMode: 'stub',
      note: input.reason,
      nextCursor: buildDriveCursor({
        startPageToken: 'stub-start-page-token',
        selectedRoots: input.selectedRoots,
        knownFiles: knownFiles.values(),
        knownFolders: [],
      }),
    };
  }

  const startPageToken = await requestDriveStartPageToken({
    accessToken: input.accessToken,
    fetchImpl: input.context.fetchImpl ?? fetch,
  });
  const walked = await walkSelectedDriveScope({
    accessToken: input.accessToken,
    fetchImpl: input.context.fetchImpl ?? fetch,
    selectedRoots: input.selectedRoots,
  });
  const previousKnownFiles = new Map(
    (input.previousState?.knownFiles ?? []).map((entry) => [entry.id, entry]),
  );
  const rawObjects = [...walked.rawObjects];
  for (const [fileId, previousKnown] of previousKnownFiles.entries()) {
    if (walked.knownFiles.has(fileId)) continue;
    rawObjects.push(
      buildDriveTombstone({
        fileId,
        observedAt: new Date().toISOString(),
        collectionId: previousKnown.collectionId,
        storageMode: previousKnown.storageMode,
        title: previousKnown.title,
        changeState: 'missing_from_scope_resync',
      }),
    );
  }
  rawObjects.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  return {
    stream: DRIVE_CURSOR_STREAM,
    mode: 'initial',
    rawObjects,
    pullMode: 'vault',
    note: input.reason,
    nextCursor: buildDriveCursor({
      startPageToken,
      selectedRoots: input.selectedRoots,
      knownFiles: walked.knownFiles.values(),
      knownFolders: walked.knownFolders.values(),
    }),
  };
}

function isScopeStructuralChange(input: {
  changeFileId: string;
  file: DriveFile | undefined;
  removed: boolean;
  target:
    | ReturnType<typeof findScopeTargetForDriveFile>
    | { status: 'known_removed'; collectionId: string; storageMode: DriveStorageMode };
  previousFolders: Map<string, DriveKnownFolder>;
}): boolean {
  if (input.previousFolders.has(input.changeFileId)) return true;
  if (input.file && isDriveFolder(input.file)) {
    return input.target.status === 'in_scope' || input.target.status === 'known_out_of_scope';
  }
  return input.removed && input.previousFolders.has(input.changeFileId);
}

async function syncGoogleDriveFiles(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<DriveRawObject>> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-drive',
      accountId: context.account.connectionId,
    });
  const selectedRoots = resolveGoogleDriveSelectedRoots(context.account.metadata);
  const previousState = parseDriveCursorState(context.cursor);
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (
    mode === 'initial' ||
    previousState.startPageToken === null ||
    previousState.scopeKey !== buildDriveScopeKey(selectedRoots)
  ) {
    return runSelectedScopeInitialSync({
      context,
      accessToken: creds.mode === 'stub' ? null : creds.accessToken,
      pullMode: creds.mode === 'stub' ? 'stub' : 'vault',
      selectedRoots,
      previousState,
      reason:
        creds.mode === 'stub'
          ? 'synthetic Google Drive selected-scope sync; vault credentials not read'
          : previousState.scopeKey && previousState.scopeKey !== buildDriveScopeKey(selectedRoots)
            ? 'bounded Google Drive selected-scope resync after selection change'
            : 'Google Drive selected-scope initial sync',
    });
  }

  if (creds.mode === 'stub') {
    return {
      stream: DRIVE_CURSOR_STREAM,
      mode: 'incremental',
      rawObjects: [],
      pullMode: 'stub',
      note: 'synthetic Google Drive incremental sync found no changes',
      nextCursor: context.cursor ?? null,
    };
  }

  const previousKnownFiles = new Map(previousState.knownFiles.map((entry) => [entry.id, entry]));
  const previousKnownFolders = new Map(previousState.knownFolders.map((entry) => [entry.id, entry]));
  let changesResult: {
    changes: NonNullable<DriveChangesResponse['changes']>;
    newStartPageToken: string;
  };
  try {
    changesResult = await listDriveChangesSinceToken({
      accessToken: creds.accessToken,
      fetchImpl: context.fetchImpl ?? fetch,
      startPageToken: previousState.startPageToken,
    });
  } catch (error) {
    const classified = classifyConnectorError(error);
    if (classified.kind !== 'cursor_expired') {
      throw error;
    }
    return runSelectedScopeInitialSync({
      context,
      accessToken: creds.accessToken,
      pullMode: 'vault',
      selectedRoots,
      previousState,
      reason: 'bounded Google Drive selected-scope resync after expired change token',
    });
  }
  let requiresBoundedResync = false;
  const nextKnownFiles = new Map(previousKnownFiles);
  const nextKnownFolders = new Map(previousKnownFolders);
  const rawObjects: DriveRawObject[] = [];

  for (const change of changesResult.changes) {
    const fileId = typeof change.fileId === 'string' ? change.fileId.trim() : '';
    if (!fileId) continue;
    const observedAt = sanitizeObservedAt(change.time ?? change.file?.modifiedTime);

    if (change.removed || !change.file) {
      const previousKnown =
        previousKnownFiles.get(fileId) ??
        (previousKnownFolders.has(fileId)
          ? {
              id: fileId,
              collectionId: previousKnownFolders.get(fileId)!.collectionId,
              storageMode: previousKnownFolders.get(fileId)!.storageMode,
              title: null,
            }
          : null);
      if (!previousKnown) continue;
      if (previousKnownFolders.has(fileId)) {
        requiresBoundedResync = true;
        break;
      }
      rawObjects.push(
        buildDriveTombstone({
          fileId,
          observedAt,
          collectionId: previousKnown.collectionId,
          storageMode: previousKnown.storageMode,
          title: previousKnown.title,
          changeState: 'removed',
        }),
      );
      nextKnownFiles.delete(fileId);
      continue;
    }

    const target = findScopeTargetForDriveFile({
      file: change.file,
      selectedRoots,
      knownFiles: [...previousKnownFiles.values()],
      knownFolders: [...nextKnownFolders.values()],
    });
    if (
      isScopeStructuralChange({
        changeFileId: fileId,
        file: change.file,
        removed: false,
        target,
        previousFolders: previousKnownFolders,
      })
    ) {
      requiresBoundedResync = true;
      break;
    }

    if (target.status === 'in_scope') {
      if (isDriveFolder(change.file)) {
        nextKnownFolders.set(fileId, {
          id: fileId,
          collectionId: target.collectionId,
          storageMode: target.storageMode === 'archived' ? 'archived' : 'reference',
        });
        continue;
      }
      const rawObject = buildActiveDriveObject({
        file: change.file,
        collectionId: target.collectionId,
        storageMode: target.storageMode,
      });
      rawObjects.push(rawObject);
      nextKnownFiles.set(fileId, buildKnownFileFromRawObject(rawObject));
      continue;
    }

    if (target.status === 'known_out_of_scope') {
      rawObjects.push(
        buildDriveTombstone({
          fileId,
          observedAt,
          collectionId: target.collectionId,
          storageMode: target.storageMode,
          title: previousKnownFiles.get(fileId)?.title ?? change.file.name ?? null,
          changeState: 'moved_out_of_scope',
        }),
      );
      nextKnownFiles.delete(fileId);
      nextKnownFolders.delete(fileId);
    }
  }

  if (requiresBoundedResync) {
    return runSelectedScopeInitialSync({
      context,
      accessToken: creds.accessToken,
      pullMode: 'vault',
      selectedRoots,
      previousState,
      reason: 'bounded Google Drive selected-scope resync after folder/scope change',
    });
  }

  rawObjects.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  return {
    stream: DRIVE_CURSOR_STREAM,
    mode: 'incremental',
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'Google Drive changes.list incremental sync captured selected-scope deltas'
        : 'Google Drive changes.list found no selected-scope changes',
    nextCursor: buildDriveCursor({
      startPageToken: changesResult.newStartPageToken,
      selectedRoots,
      knownFiles: nextKnownFiles.values(),
      knownFolders: nextKnownFolders.values(),
    }),
  };
}

function normalizeDriveRawObject(input: {
  workspaceId: string;
  connectionId: string;
  displayName?: string;
  rawObject: DriveRawObject;
}): NormalizedConnectorRecord {
  const label = labelForDriveAccount(input);
  const externalId = driveFileExternalId(input.rawObject.id);
  const observedAt = sanitizeObservedAt(
    input.rawObject.observedAt,
    input.rawObject.modifiedTime ?? new Date().toISOString(),
  );
  const sourceMode = input.rawObject.__mode ?? 'vault';
  const title = input.rawObject.name?.trim() || '(untitled file)';
  const storageMode = normalizeDriveStorageMode(input.rawObject.storageMode);
  const canonicalReference =
    !input.rawObject.deleted && sourceMode === 'vault' && input.rawObject.id
      ? `https://drive.google.com/file/d/${encodeURIComponent(input.rawObject.id)}/view`
      : undefined;
  const eventVersion = input.rawObject.deleted
    ? `${input.rawObject.changeState ?? 'removed'}:${observedAt}`
    : input.rawObject.modifiedTime ?? observedAt;
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}/${eventVersion}`;
  const eventType = input.rawObject.deleted
    ? `google-drive.file.${input.rawObject.changeState ?? 'removed'}`
    : 'google-drive.file.updated';
  const object: ExternalObject = {
    provider: 'google-drive',
    accountId: input.connectionId,
    collectionId: input.rawObject.collectionId,
    externalId,
    externalVersion: eventVersion,
    objectType: 'file',
    title,
    contentReference: canonicalReference,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: input.rawObject.deleted ?? false,
    attachments: [],
    permissionsSnapshot: input.rawObject.permissions ?? {},
    metadata: {
      mimeType: input.rawObject.mimeType ?? 'unknown',
      parentIds: input.rawObject.parents ?? [],
      sourceMode,
      changeState: input.rawObject.changeState ?? 'active',
    },
    canonicalReference,
  };
  const note =
    input.rawObject.deleted
      ? 'Google Drive object left the selected scope or access was removed.'
      : sourceMode === 'stub'
        ? 'Synthetic Google Drive selected-scope sync (vault credentials not read).'
        : 'Source: vault-backed Google Drive selected-scope sync.';
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'google-drive',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: eventVersion,
      },
      event_type: eventType,
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        reference: canonicalReference,
        text: `${label}: ${title}`,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: storageMode,
      },
      provenance: {
        mimeType: input.rawObject.mimeType ?? 'unknown',
        sourceMode,
        changeState: input.rawObject.changeState ?? 'active',
      },
    },
    capture: {
      title: `${label}: ${title}`,
      text: [
        `Connector: Google Drive (${sourceMode})`,
        `File: ${title}`,
        `MIME type: ${input.rawObject.mimeType ?? 'unknown'}`,
        input.rawObject.modifiedTime
          ? `Modified: ${input.rawObject.modifiedTime}`
          : 'Modified: unknown',
        `State: ${input.rawObject.changeState ?? 'active'}`,
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

async function checkpointDriveFiles(input: {
  page: ConnectorSyncPage<DriveRawObject>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  return input.page.nextCursor ?? input.previousCursor;
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

  const scopeValidation = validateGoogleDriveSelectionScope(context.account.metadata);
  if (!scopeValidation.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-drive',
      status: 'degraded',
      note: `Google Drive selected scope missing: ${scopeValidation.missing.join(', ')}`,
      vaultRef,
      checks: [
        {
          name: 'selected_scope',
          status: 'fail',
          detail: `Missing selected Google Drive scope metadata: ${scopeValidation.missing.join(', ')}`,
        },
      ],
    });
  }

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
    'https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true',
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
      note: 'Google Drive OAuth token is valid and the change-token probe succeeded',
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
          detail: 'Google Drive changes.getStartPageToken returned HTTP 200.',
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
          detail: `Google Drive changes.getStartPageToken returned HTTP ${response.status}.`,
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
        detail: `Google Drive changes.getStartPageToken returned HTTP ${response.status}.`,
      },
    ],
  });
}

export const googleDriveConnector: RegisteredConnector<DriveRawObject> = {
  manifest: {
    id: 'google-drive',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: DRIVE_CURSOR_STREAM,
    auth: 'oauth2',
    capabilities: ['files.read', 'changes.list', 'changes.watch'],
    supports: {
      discover: false,
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      live_fetch: false,
      webhooks: true,
      write: false,
    },
    storage_modes: ['reference', 'indexed'],
    rate_limit_strategy: 'provider_headers',
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope(context) {
      const validation = validateGoogleDriveSelectionScope(context.account.metadata);
      const scopes = context.account.scopes ?? [];
      if (!scopes.some((scope) => scope.includes(DRIVE_RESTRICTED_SCOPE) || scope === 'files.read')) {
        validation.missing.push(`oauth scope ${DRIVE_RESTRICTED_SCOPE}`);
      }
      return {
        ok: validation.missing.length === 0,
        missing: validation.missing,
      };
    },
    async initialSync(context) {
      return syncGoogleDriveFiles(context, 'initial');
    },
    async incrementalSync(context) {
      return syncGoogleDriveFiles(context, 'incremental');
    },
    async normalize(context) {
      return normalizeDriveRawObject({
        workspaceId: context.workspaceId,
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
        rawObject: context.rawObject,
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
          DRIVE_CURSOR_STREAM,
          {
            ...parseDriveCursorState(initialRun.nextCursor),
            startPageToken: 'expired-drive-token',
            scopeKey: buildDriveScopeKey(resolveGoogleDriveSelectedRoots(baseContext.account.metadata)),
          },
          DRIVE_CURSOR_SCHEMA_VERSION,
        ),
      };
    },
    buildRevokeContext(context) {
      return {
        ...context,
        account: {
          ...context.account,
          vaultRef: context.account.vaultRef ?? 'vault:test/google-drive',
        },
      };
    },
  },
};

/** Stub Drive delta: invents file change events from vault ref only. */
export function pullGoogleDriveStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  metadata?: Record<string, unknown>;
}): DrivePullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'google-drive',
      accountId: input.connectionId,
    });
  const rawObjects = buildStubDriveObjects(input.metadata);
  const items = rawObjects.map((rawObject) => {
    const record = normalizeDriveRawObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      connectionId: input.connectionId,
      displayName: input.displayName,
      rawObject,
    });
    return {
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    };
  });
  const selectedRoots = resolveGoogleDriveSelectedRoots(input.metadata);
  const knownFiles = rawObjects.map((rawObject) => buildKnownFileFromRawObject(rawObject));

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Google Drive selected-scope sync; vault credentials not read',
    items,
    nextCursor: buildDriveCursor({
      startPageToken: 'stub-start-page-token',
      selectedRoots,
      knownFiles,
      knownFolders: [],
    }),
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
  metadata?: Record<string, unknown>;
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
        scopes: ['drive.file'],
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

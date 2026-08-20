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
import { parseDocument } from '@memory-os/ingestion';
import XLSX from 'xlsx';

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
  shared?: boolean;
  __mode?: 'stub' | 'vault';
};

type DrivePermissionGrant = {
  principalKey: string;
  role: string;
};

type DrivePermissionSnapshot = {
  access: 'granted' | 'revoked';
  reason?: string;
  grants?: Array<
    DrivePermissionGrant & {
      type?: string;
      emailAddress?: string;
      domain?: string;
      allowFileDiscovery?: boolean;
      pendingOwner?: boolean;
      deleted?: boolean;
    }
  >;
  grantCount?: number;
  fingerprint?: string | null;
  shared?: boolean;
  fetchedAt?: string;
} & Record<string, unknown>;

type DriveApiPermission = {
  id?: string;
  type?: string;
  role?: string;
  emailAddress?: string;
  domain?: string;
  allowFileDiscovery?: boolean;
  pendingOwner?: boolean;
  deleted?: boolean;
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
  permissions?: DrivePermissionSnapshot;
  parsedText?: string;
  captureMimeType?: string;
  captureFilename?: string;
  exportMimeType?: string;
  parser?: string;
  exportError?: string;
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
  permissionGrants?: DrivePermissionGrant[];
  permissionFingerprint?: string | null;
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
const DRIVE_DOC_MIME = 'application/vnd.google-apps.document';
const DRIVE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const DRIVE_SLIDES_MIME = 'application/vnd.google-apps.presentation';
const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime,parents,trashed,shared';
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

function parseDriveFileExternalId(externalId: string): string {
  return externalId.startsWith('file/') ? externalId.slice('file/'.length) : externalId;
}

function sanitizeObservedAt(value: string | undefined, fallback = new Date().toISOString()): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function wantsDriveExtractedText(storageMode: DriveStorageMode): boolean {
  return storageMode === 'indexed' || storageMode === 'archived';
}

function isGoogleNativeDriveMime(mimeType: string | undefined): boolean {
  return (
    mimeType === DRIVE_DOC_MIME || mimeType === DRIVE_SHEET_MIME || mimeType === DRIVE_SLIDES_MIME
  );
}

function buildDriveCanonicalReference(fileId: string, mimeType: string | undefined): string {
  switch (mimeType) {
    case DRIVE_DOC_MIME:
      return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
    case DRIVE_SHEET_MIME:
      return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`;
    case DRIVE_SLIDES_MIME:
      return `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/edit`;
    default:
      return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  }
}

function buildDriveVirtualFilename(externalId: string, suffix = ''): string {
  return `google-drive://${externalId}${suffix}`;
}

function buildDrivePermissionPrincipalKey(permission: DriveApiPermission): string {
  if (typeof permission.id === 'string' && permission.id.trim().length > 0) {
    return `permission:${permission.id.trim()}`;
  }
  if (typeof permission.emailAddress === 'string' && permission.emailAddress.trim().length > 0) {
    return `email:${permission.emailAddress.trim().toLowerCase()}`;
  }
  if (typeof permission.domain === 'string' && permission.domain.trim().length > 0) {
    return `domain:${permission.domain.trim().toLowerCase()}`;
  }
  if (typeof permission.type === 'string' && permission.type.trim().length > 0) {
    return `type:${permission.type.trim().toLowerCase()}`;
  }
  return 'unknown';
}

function buildDrivePermissionFingerprint(grants: DrivePermissionGrant[]): string | null {
  if (grants.length === 0) return null;
  return grants
    .map((grant) => `${grant.principalKey}:${grant.role}`)
    .sort()
    .join('|');
}

function parseDrivePermissionGrants(value: unknown): DrivePermissionGrant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isPlainObject(entry)) return [];
    const principalKey =
      typeof entry.principalKey === 'string' ? entry.principalKey.trim() : '';
    const role = typeof entry.role === 'string' ? entry.role.trim() : '';
    if (!principalKey || !role) return [];
    return [{ principalKey, role } satisfies DrivePermissionGrant];
  });
}

function drivePermissionRoleRank(role: string): number {
  switch (role) {
    case 'owner':
      return 6;
    case 'organizer':
      return 5;
    case 'fileOrganizer':
      return 4;
    case 'writer':
      return 3;
    case 'commenter':
      return 2;
    case 'reader':
      return 1;
    default:
      return 0;
  }
}

function didDrivePermissionSnapshotShrink(
  previousKnown: DriveKnownFile | undefined,
  currentSnapshot: DrivePermissionSnapshot,
): boolean {
  const previousGrants = previousKnown?.permissionGrants ?? [];
  const currentGrants = parseDrivePermissionGrants(currentSnapshot.grants);
  if (previousGrants.length === 0 || currentGrants.length === 0) {
    return false;
  }
  const currentRoles = new Map(currentGrants.map((grant) => [grant.principalKey, grant.role]));
  return previousGrants.some((grant) => {
    const currentRole = currentRoles.get(grant.principalKey);
    if (!currentRole) return true;
    return drivePermissionRoleRank(currentRole) < drivePermissionRoleRank(grant.role);
  });
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
            permissionGrants: parseDrivePermissionGrants(entry.permissionGrants),
            permissionFingerprint:
              typeof entry.permissionFingerprint === 'string'
                ? entry.permissionFingerprint
                : null,
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
          storageMode: root.storageMode,
        },
      ]),
  );
  for (const folder of input.knownFolders ?? []) {
    folderCollections.set(folder.id, {
      collectionId: folder.collectionId,
      storageMode: folder.storageMode,
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
      storageMode: selectedFolder.storageMode,
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
  const permissionGrants = parseDrivePermissionGrants(rawObject.permissions?.grants);
  return {
    id: rawObject.id,
    collectionId: rawObject.collectionId ?? 'google-drive:unknown',
    storageMode: normalizeDriveStorageMode(rawObject.storageMode),
    title: rawObject.name ?? null,
    permissionGrants,
    permissionFingerprint:
      rawObject.permissions?.fingerprint ?? buildDrivePermissionFingerprint(permissionGrants),
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

function buildDrivePermissionSnapshot(input: {
  permissions: DriveApiPermission[];
  shared: boolean | undefined;
  fetchedAt: string;
}): DrivePermissionSnapshot {
  const grants = input.permissions
    .map((permission) => {
      const role = typeof permission.role === 'string' ? permission.role.trim() : '';
      if (!role) return null;
      return {
        principalKey: buildDrivePermissionPrincipalKey(permission),
        role,
        type: typeof permission.type === 'string' ? permission.type : undefined,
        emailAddress:
          typeof permission.emailAddress === 'string' ? permission.emailAddress : undefined,
        domain: typeof permission.domain === 'string' ? permission.domain : undefined,
        allowFileDiscovery:
          typeof permission.allowFileDiscovery === 'boolean'
            ? permission.allowFileDiscovery
            : undefined,
        pendingOwner:
          typeof permission.pendingOwner === 'boolean' ? permission.pendingOwner : undefined,
        deleted: typeof permission.deleted === 'boolean' ? permission.deleted : undefined,
      };
    })
    .filter((grant): grant is NonNullable<typeof grant> => grant !== null)
    .sort((left, right) =>
      `${left.principalKey}:${left.role}`.localeCompare(`${right.principalKey}:${right.role}`),
    );
  return {
    access: 'granted',
    grants,
    grantCount: grants.length,
    fingerprint: buildDrivePermissionFingerprint(grants),
    shared: input.shared,
    fetchedAt: input.fetchedAt,
  };
}

async function requestDrivePermissionSnapshot(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  fileId: string;
}): Promise<DrivePermissionSnapshot> {
  const fetchedAt = new Date().toISOString();
  const response = await input.fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.fileId,
    )}?fields=${encodeURIComponent(
      'shared,permissions(id,type,role,emailAddress,domain,allowFileDiscovery,pendingOwner,deleted)',
    )}&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (response.status === 403 || response.status === 404) {
    return {
      access: 'granted',
      reason: 'permission_snapshot_unavailable',
      fetchedAt,
    };
  }
  const errorText = response.ok ? '' : await parseDriveErrorText(response);
  assertDriveResponseOk({
    response,
    errorText,
    action: 'files.get permissions',
  });
  const payload = (await response.json()) as {
    shared?: boolean;
    permissions?: DriveApiPermission[];
  };
  return buildDrivePermissionSnapshot({
    permissions: payload.permissions ?? [],
    shared: payload.shared,
    fetchedAt,
  });
}

type DriveNativeExportPlan = {
  exportMimeType: string;
  exportFilename: string;
  parser: string;
};

function resolveDriveNativeExportPlan(input: {
  fileId: string;
  name?: string;
  mimeType?: string;
}): DriveNativeExportPlan | null {
  const baseName = input.name?.trim() || input.fileId;
  switch (input.mimeType) {
    case DRIVE_DOC_MIME:
      return {
        exportMimeType: 'text/plain',
        exportFilename: `${baseName}.txt`,
        parser: 'google-doc-text',
      };
    case DRIVE_SHEET_MIME:
      return {
        exportMimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        exportFilename: `${baseName}.xlsx`,
        parser: 'google-sheet-xlsx',
      };
    case DRIVE_SLIDES_MIME:
      return {
        exportMimeType: 'text/plain',
        exportFilename: `${baseName}.txt`,
        parser: 'google-slides-text',
      };
    default:
      return null;
  }
}

function parseDriveSheetWorkbook(input: {
  bytes: Buffer;
  filename: string;
}): {
  text: string;
  mimeType: 'text/plain';
  filename: string;
} {
  const workbook = XLSX.read(input.bytes, { type: 'buffer' });
  const sheetTexts = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return '';
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    });
    const lines = rows
      .map((row) =>
        row
          .map((cell) => String(cell ?? '').trim())
          .join('\t')
          .trim(),
      )
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return `Sheet: ${sheetName}`;
    }
    return [`Sheet: ${sheetName}`, ...lines].join('\n');
  }).filter((text) => text.trim().length > 0);
  const text = sheetTexts.join('\n\n').trim();
  if (!text) {
    throw new Error('no extractable text in Google Sheets export');
  }
  return {
    text,
    mimeType: 'text/plain',
    filename: input.filename,
  };
}

async function exportAndParseDriveNativeFile(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  rawObject: DriveRawObject;
}): Promise<{
  parsedText: string;
  captureMimeType: 'text/plain';
  captureFilename: string;
  exportMimeType: string;
  parser: string;
} | null> {
  const plan = resolveDriveNativeExportPlan({
    fileId: input.rawObject.id,
    name: input.rawObject.name,
    mimeType: input.rawObject.mimeType,
  });
  if (!plan) return null;
  const response = await input.fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.rawObject.id,
    )}/export?mimeType=${encodeURIComponent(plan.exportMimeType)}`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: plan.exportMimeType,
      },
    },
  );
  const errorText = response.ok ? '' : await parseDriveErrorText(response);
  assertDriveResponseOk({
    response,
    errorText,
    action: 'files.export',
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const parsed =
    plan.exportMimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ? parseDriveSheetWorkbook({
          bytes,
          filename: plan.exportFilename,
        })
      : await parseDocument({
          filename: plan.exportFilename,
          mimeType: plan.exportMimeType,
          bytes,
        });
  return {
    parsedText: parsed.text.trim(),
    captureMimeType: 'text/plain',
    captureFilename: buildDriveVirtualFilename(driveFileExternalId(input.rawObject.id), '.indexed.txt'),
    exportMimeType: plan.exportMimeType,
    parser: plan.parser,
  };
}

async function enrichActiveDriveObject(input: {
  rawObject: DriveRawObject;
  accessToken: string;
  fetchImpl: typeof fetch;
  previousKnown?: DriveKnownFile;
}): Promise<DriveRawObject> {
  const permissions = await requestDrivePermissionSnapshot({
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    fileId: input.rawObject.id,
  });
  if (didDrivePermissionSnapshotShrink(input.previousKnown, permissions)) {
    return {
      ...buildDriveTombstone({
        fileId: input.rawObject.id,
        observedAt: input.rawObject.observedAt,
        collectionId: input.rawObject.collectionId ?? 'google-drive:unknown',
        storageMode: normalizeDriveStorageMode(input.rawObject.storageMode),
        title: input.rawObject.name ?? null,
        changeState: 'permission_lost',
      }),
      permissions: {
        access: 'revoked',
        reason: 'permissions_snapshot_shrank',
        previousFingerprint: input.previousKnown?.permissionFingerprint ?? null,
        currentFingerprint: permissions.fingerprint ?? null,
        previousGrantCount: input.previousKnown?.permissionGrants?.length ?? 0,
        currentGrantCount: parseDrivePermissionGrants(permissions.grants).length,
        fetchedAt: permissions.fetchedAt,
      },
    };
  }
  if (
    !wantsDriveExtractedText(normalizeDriveStorageMode(input.rawObject.storageMode)) ||
    !isGoogleNativeDriveMime(input.rawObject.mimeType)
  ) {
    return {
      ...input.rawObject,
      permissions,
    };
  }
  try {
    const exported = await exportAndParseDriveNativeFile({
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      rawObject: input.rawObject,
    });
    if (!exported) {
      return {
        ...input.rawObject,
        permissions,
      };
    }
    return {
      ...input.rawObject,
      permissions,
      parsedText: exported.parsedText,
      captureMimeType: exported.captureMimeType,
      captureFilename: exported.captureFilename,
      exportMimeType: exported.exportMimeType,
      parser: exported.parser,
    };
  } catch (error) {
    return {
      ...input.rawObject,
      permissions,
      exportError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function walkSelectedDriveScope(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  selectedRoots: DriveSelectedRoot[];
  previousKnownFiles?: Map<string, DriveKnownFile>;
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
      const storageMode = root.storageMode;
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
    const rawObject = await enrichActiveDriveObject({
      rawObject: buildActiveDriveObject({
        file: file,
        collectionId: root.collectionId,
        storageMode: root.storageMode,
      }),
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
      previousKnown: input.previousKnownFiles?.get(file.id),
    });
    rawObjects.push(rawObject);
    if (!rawObject.deleted) {
      knownFiles.set(file.id, buildKnownFileFromRawObject(rawObject));
    }
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
      const rawObject = await enrichActiveDriveObject({
        rawObject: buildActiveDriveObject({
          file: child,
          collectionId: current.collectionId,
          storageMode: current.storageMode,
        }),
        accessToken: input.accessToken,
        fetchImpl: input.fetchImpl,
        previousKnown: input.previousKnownFiles?.get(child.id),
      });
      rawObjects.push(rawObject);
      if (!rawObject.deleted) {
        knownFiles.set(child.id, buildKnownFileFromRawObject(rawObject));
      }
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
  const previousKnownFiles = new Map(
    (input.previousState?.knownFiles ?? []).map((entry) => [entry.id, entry]),
  );
  const walked = await walkSelectedDriveScope({
    accessToken: input.accessToken,
    fetchImpl: input.context.fetchImpl ?? fetch,
    selectedRoots: input.selectedRoots,
    previousKnownFiles,
  });
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
          storageMode: target.storageMode,
        });
        continue;
      }
      const rawObject = buildActiveDriveObject({
        file: change.file,
        collectionId: target.collectionId,
        storageMode: target.storageMode,
      });
      const enrichedRawObject = await enrichActiveDriveObject({
        rawObject,
        accessToken: creds.accessToken,
        fetchImpl: context.fetchImpl ?? fetch,
        previousKnown: previousKnownFiles.get(fileId),
      });
      rawObjects.push(enrichedRawObject);
      if (enrichedRawObject.deleted) {
        nextKnownFiles.delete(fileId);
        continue;
      }
      nextKnownFiles.set(fileId, buildKnownFileFromRawObject(enrichedRawObject));
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
  const wantsIndexedContent =
    wantsDriveExtractedText(storageMode) && isGoogleNativeDriveMime(input.rawObject.mimeType);
  const parsedText = input.rawObject.parsedText?.trim() ?? '';
  const hasParsedText = parsedText.length > 0;
  const canonicalReference =
    !input.rawObject.deleted && sourceMode === 'vault' && input.rawObject.id
      ? buildDriveCanonicalReference(input.rawObject.id, input.rawObject.mimeType)
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
      sourcePermissions: input.rawObject.permissions ?? {},
      export:
        wantsIndexedContent || input.rawObject.exportError
          ? {
              requested: wantsIndexedContent,
              parser: input.rawObject.parser ?? null,
              exportMimeType: input.rawObject.exportMimeType ?? null,
              error: input.rawObject.exportError ?? null,
            }
          : undefined,
    },
    canonicalReference,
  };
  const note =
    input.rawObject.deleted
      ? 'Google Drive object left the selected scope or access was removed.'
      : sourceMode === 'stub'
        ? 'Synthetic Google Drive selected-scope sync (vault credentials not read).'
        : 'Source: vault-backed Google Drive selected-scope sync.';
  const exportNote = hasParsedText
    ? `Indexed export: ${input.rawObject.parser ?? 'google-native-export'}`
    : input.rawObject.exportError
      ? `Indexed export fallback: ${input.rawObject.exportError}`
      : null;
  const captureText = [
    `Connector: Google Drive (${sourceMode})`,
    `File: ${title}`,
    `MIME type: ${input.rawObject.mimeType ?? 'unknown'}`,
    input.rawObject.modifiedTime
      ? `Modified: ${input.rawObject.modifiedTime}`
      : 'Modified: unknown',
    `State: ${input.rawObject.changeState ?? 'active'}`,
    canonicalReference ? `Reference: ${canonicalReference}` : null,
    exportNote,
    note,
    hasParsedText ? '' : null,
    hasParsedText ? parsedText : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  const permissionGrants = parseDrivePermissionGrants(input.rawObject.permissions?.grants);
  const permissionFingerprint =
    input.rawObject.permissions?.fingerprint ?? buildDrivePermissionFingerprint(permissionGrants);
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
        mime_type: input.rawObject.captureMimeType ?? 'text/plain',
        reference: canonicalReference,
        text: captureText,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: storageMode,
      },
      provenance: {
        mimeType: input.rawObject.mimeType ?? 'unknown',
        sourceMode,
        changeState: input.rawObject.changeState ?? 'active',
        parser: input.rawObject.parser ?? null,
        exportMimeType: input.rawObject.exportMimeType ?? null,
        permissionFingerprint,
        permissionGrantCount: permissionGrants.length,
      },
    },
    capture: {
      title: `${label}: ${title}`,
      text: captureText,
      filename: input.rawObject.captureFilename ?? buildDriveVirtualFilename(externalId),
      mimeType: input.rawObject.captureMimeType ?? 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

async function checkpointDriveFiles(input: {
  page: ConnectorSyncPage<DriveRawObject>;
  records: NormalizedConnectorRecord[];
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const nextCursor = input.page.nextCursor ?? input.previousCursor;
  if (!nextCursor) return null;
  const nextState = parseDriveCursorState(nextCursor);
  const knownFiles = new Map(nextState.knownFiles.map((entry) => [entry.id, entry]));
  for (const record of input.records) {
    const fileId = parseDriveFileExternalId(record.externalObject.externalId);
    if (record.externalObject.deleted) {
      knownFiles.delete(fileId);
      continue;
    }
    const permissionGrants = parseDrivePermissionGrants(
      record.externalObject.permissionsSnapshot.grants,
    );
    knownFiles.set(fileId, {
      id: fileId,
      collectionId: record.externalObject.collectionId ?? 'google-drive:unknown',
      storageMode: normalizeDriveStorageMode(record.envelope.scope.storage_mode),
      title: record.externalObject.title ?? null,
      permissionGrants,
      permissionFingerprint:
        typeof record.externalObject.permissionsSnapshot.fingerprint === 'string'
          ? record.externalObject.permissionsSnapshot.fingerprint
          : buildDrivePermissionFingerprint(permissionGrants),
    });
  }
  return buildDefaultCursor(
    DRIVE_CURSOR_STREAM,
    {
      startPageToken: nextState.startPageToken,
      scopeKey: nextState.scopeKey,
      knownFiles: [...knownFiles.values()],
      knownFolders: nextState.knownFolders,
    },
    nextCursor.schemaVersion,
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
    async checkpoint({ page, records, previousCursor }) {
      return checkpointDriveFiles({ page, records, previousCursor });
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

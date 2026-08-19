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
import {
  canIngestAppleCompanionFile,
  canIngestApplePhotoLibraryAsset,
  listAppleCompanionIdentifierCandidates,
  matchesAppleCompanionSelectedAsset,
  type AppleCompanionIngestRequest,
  type AppleCompanionFileBookmark,
  type AppleCompanionFilesCheckpoint,
  type AppleCompanionPhotoLibraryCheckpoint,
  type ApplePermissionState,
  resolveAppleCompanionFileBookmark,
} from '@memory-os/schemas';

export const APPLE_BRIDGE_CURSOR_STREAM = 'apple:device-items' as const;
const APPLE_PHOTO_LIBRARY_CHANGE_TOKEN_KEY = 'photoLibraryChangeToken' as const;
const APPLE_PHOTO_LIBRARY_DELTA_REASON_KEY = 'photoLibraryDeltaReason' as const;
const APPLE_FILES_CHANGE_TOKEN_KEY = 'filesChangeToken' as const;
const APPLE_FILES_DELTA_REASON_KEY = 'filesSelectionDeltaReason' as const;

type AppleBridgeScenario = 'default' | 'rate_limit';

export type AppleBridgeRawObject = Omit<
  AppleCompanionIngestRequest,
  'needs_companion_processing'
> & {
  needs_companion_processing?: boolean;
  deleted?: boolean;
  permissions?: Record<string, unknown>;
  poison?: boolean;
  photo_library_checkpoint?: AppleCompanionPhotoLibraryCheckpoint;
  files_checkpoint?: AppleCompanionFilesCheckpoint;
};

export type ApplePhotoLibrarySelectionDeltaInput = {
  previousCheckpoint: AppleCompanionPhotoLibraryCheckpoint | null;
  nextCheckpoint: AppleCompanionPhotoLibraryCheckpoint;
  knownAssets: AppleBridgeRawObject[];
  currentAssets: AppleBridgeRawObject[];
};

type ApplePhotoLibraryDeltaReason = 'selection_removed' | 'permission_revoked';
type AppleFilesDeltaReason = 'bookmark_removed';

export type AppleFilesSelectionDeltaInput = {
  previousCheckpoint: AppleCompanionFilesCheckpoint | null;
  nextCheckpoint: AppleCompanionFilesCheckpoint;
  knownFiles: AppleBridgeRawObject[];
  currentFiles: AppleBridgeRawObject[];
};

export type AppleFilesSelectionDeltaResult =
  | {
      status: 'ready';
      rawObjects: AppleBridgeRawObject[];
    }
  | {
      status: 'reselect_required';
      error_code: 'reselect_required';
      stale_bookmark_ids: string[];
      rawObjects: [];
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

function isApplePermissionState(value: unknown): value is ApplePermissionState {
  switch (value) {
    case 'not_determined':
    case 'limited':
    case 'full':
    case 'denied':
      return true;
    default:
      return false;
  }
}

function hasPhotoLibraryAccess(permissionState: ApplePermissionState): boolean {
  switch (permissionState) {
    case 'limited':
    case 'full':
      return true;
    case 'not_determined':
    case 'denied':
      return false;
    default: {
      const _exhaustive: never = permissionState;
      return _exhaustive;
    }
  }
}

function isPhotoLibraryAsset(rawObject: AppleBridgeRawObject): boolean {
  return rawObject.source === 'photo_library' && rawObject.kind === 'photo';
}

function isDocumentPickerFile(rawObject: AppleBridgeRawObject): boolean {
  return rawObject.source === 'document_picker' && rawObject.kind === 'file';
}

function resolvePhotoLibraryPermissionState(rawObject: AppleBridgeRawObject): ApplePermissionState {
  const checkpointState = rawObject.photo_library_checkpoint?.permission_state;
  if (checkpointState) return checkpointState;
  const permissionState = rawObject.permissions?.photo_library;
  return isApplePermissionState(permissionState) ? permissionState : 'not_determined';
}

function resolveFilesPermissionState(rawObject: AppleBridgeRawObject): ApplePermissionState {
  const checkpointState = rawObject.files_checkpoint?.permission_state;
  if (checkpointState) return checkpointState;
  const permissionState = rawObject.permissions?.files;
  return isApplePermissionState(permissionState) ? permissionState : 'not_determined';
}

function withPhotoLibraryCheckpoint(
  rawObject: AppleBridgeRawObject,
  checkpoint: AppleCompanionPhotoLibraryCheckpoint,
): AppleBridgeRawObject {
  return {
    ...rawObject,
    external_version: rawObject.external_version ?? checkpoint.change_token ?? rawObject.observed_at,
    permissions: {
      ...rawObject.permissions,
      photo_library: checkpoint.permission_state,
    },
    photo_library_checkpoint: checkpoint,
    metadata: {
      ...rawObject.metadata,
      photo_library_change_token: checkpoint.change_token,
    },
  };
}

function findFolderMonitorCheckpoint(
  checkpoint: AppleCompanionFilesCheckpoint,
  bookmark: AppleCompanionFileBookmark,
) {
  return checkpoint.folder_checkpoints.find(
    (folderCheckpoint) =>
      folderCheckpoint.bookmark_id === bookmark.bookmark_id &&
      folderCheckpoint.provider_item_identifier === bookmark.provider_item_identifier,
  );
}

function withFilesCheckpoint(
  rawObject: AppleBridgeRawObject,
  checkpoint: AppleCompanionFilesCheckpoint,
  bookmark: AppleCompanionFileBookmark,
): AppleBridgeRawObject {
  const folderCheckpoint = findFolderMonitorCheckpoint(checkpoint, bookmark);
  return {
    ...rawObject,
    external_version:
      rawObject.external_version ?? folderCheckpoint?.change_token ?? rawObject.observed_at,
    permissions: {
      ...rawObject.permissions,
      files: checkpoint.permission_state,
    },
    files_checkpoint: checkpoint,
    metadata: {
      ...rawObject.metadata,
      files_bookmark_id: bookmark.bookmark_id,
      files_change_token: folderCheckpoint?.change_token ?? null,
    },
  };
}

function buildPhotoLibraryAssetIndex(
  assets: AppleBridgeRawObject[],
): Map<string, AppleBridgeRawObject> {
  const index = new Map<string, AppleBridgeRawObject>();
  for (const asset of assets) {
    for (const key of listAppleCompanionIdentifierCandidates(asset.identifiers)) {
      if (!index.has(key)) {
        index.set(key, asset);
      }
    }
  }
  return index;
}

function resolveProviderItemIdentifier(rawObject: AppleBridgeRawObject): string | null {
  return rawObject.identifiers.provider_item_identifier?.trim() || null;
}

function buildFilesIndex(rawObjects: AppleBridgeRawObject[]): Map<string, AppleBridgeRawObject> {
  const index = new Map<string, AppleBridgeRawObject>();
  for (const rawObject of rawObjects) {
    const providerItemIdentifier = resolveProviderItemIdentifier(rawObject);
    if (providerItemIdentifier && !index.has(providerItemIdentifier)) {
      index.set(providerItemIdentifier, rawObject);
    }
  }
  return index;
}

function findPhotoLibraryAsset(
  index: Map<string, AppleBridgeRawObject>,
  rawObject: AppleBridgeRawObject,
): AppleBridgeRawObject | null {
  for (const key of listAppleCompanionIdentifierCandidates(rawObject.identifiers)) {
    const match = index.get(key);
    if (match) return match;
  }
  return null;
}

function hasAppleBridgeRawObjectChanged(
  current: AppleBridgeRawObject,
  previous: AppleBridgeRawObject,
): boolean {
  return (
    current.external_version !== previous.external_version ||
    current.observed_at !== previous.observed_at ||
    current.title !== previous.title ||
    current.filename !== previous.filename ||
    current.mime_type !== previous.mime_type ||
    current.url !== previous.url
  );
}

function buildPhotoLibraryTombstone(
  rawObject: AppleBridgeRawObject,
  checkpoint: AppleCompanionPhotoLibraryCheckpoint,
  reason: ApplePhotoLibraryDeltaReason,
): AppleBridgeRawObject {
  const checkpointed = withPhotoLibraryCheckpoint(rawObject, checkpoint);
  return {
    ...checkpointed,
    deleted: true,
    external_version: checkpoint.change_token ?? checkpointed.external_version,
    idempotency_key: `${rawObject.idempotency_key}/${reason}/${checkpoint.change_token ?? 'cursor'}`,
    metadata: {
      ...checkpointed.metadata,
      [APPLE_PHOTO_LIBRARY_DELTA_REASON_KEY]: reason,
    },
  };
}

function buildFilesTombstone(
  rawObject: AppleBridgeRawObject,
  checkpoint: AppleCompanionFilesCheckpoint,
  bookmark: AppleCompanionFileBookmark,
  reason: AppleFilesDeltaReason,
): AppleBridgeRawObject {
  const checkpointed = withFilesCheckpoint(rawObject, checkpoint, bookmark);
  return {
    ...checkpointed,
    deleted: true,
    external_version:
      findFolderMonitorCheckpoint(checkpoint, bookmark)?.change_token ?? checkpointed.external_version,
    idempotency_key: `${rawObject.idempotency_key}/${reason}/${bookmark.bookmark_id}`,
    metadata: {
      ...checkpointed.metadata,
      [APPLE_FILES_DELTA_REASON_KEY]: reason,
    },
  };
}

function uniqueRawObjectsByItemId(rawObjects: AppleBridgeRawObject[]): AppleBridgeRawObject[] {
  const seen = new Set<string>();
  return rawObjects.filter((rawObject) => {
    if (seen.has(rawObject.item_id)) return false;
    seen.add(rawObject.item_id);
    return true;
  });
}

export function filterAppleBridgeRawObjectsForCurrentSelection(
  rawObjects: AppleBridgeRawObject[],
): AppleBridgeRawObject[] {
  return filterAppleBridgeFileRawObjectsForCurrentSelection(
    rawObjects.filter((rawObject) => {
      if (!isPhotoLibraryAsset(rawObject)) return true;
      if (rawObject.deleted) return true;

      const permissionState = resolvePhotoLibraryPermissionState(rawObject);
      switch (permissionState) {
        case 'limited':
          return canIngestApplePhotoLibraryAsset({
            permissionState,
            identifiers: rawObject.identifiers,
            selectedAssets: rawObject.photo_library_checkpoint?.selected_assets ?? [],
          });
        case 'full':
        case 'denied':
        case 'not_determined':
          return false;
        default: {
          const _exhaustive: never = permissionState;
          return _exhaustive;
        }
      }
    }),
  );
}

export function filterAppleBridgeFileRawObjectsForCurrentSelection(
  rawObjects: AppleBridgeRawObject[],
): AppleBridgeRawObject[] {
  return rawObjects.filter((rawObject) => {
    if (!isDocumentPickerFile(rawObject)) return true;
    if (rawObject.deleted) return true;

    const permissionState = resolveFilesPermissionState(rawObject);
    switch (permissionState) {
      case 'limited':
        return canIngestAppleCompanionFile({
          identifiers: rawObject.identifiers,
          selectedBookmarks: rawObject.files_checkpoint?.selected_bookmarks ?? [],
        });
      case 'full':
      case 'denied':
      case 'not_determined':
        return false;
      default: {
        const _exhaustive: never = permissionState;
        return _exhaustive;
      }
    }
  });
}

export function buildAppleFilesSelectionDelta(
  input: AppleFilesSelectionDeltaInput,
): AppleFilesSelectionDeltaResult {
  switch (input.nextCheckpoint.permission_state) {
    case 'limited': {
      const knownFilesIndex = buildFilesIndex(input.knownFiles);
      const delta: AppleBridgeRawObject[] = [];
      const staleBookmarkIds = new Set<string>();

      for (const file of input.currentFiles) {
        const resolution = resolveAppleCompanionFileBookmark({
          identifiers: file.identifiers,
          selectedBookmarks: input.nextCheckpoint.selected_bookmarks,
        });
        switch (resolution.status) {
          case 'granted': {
            const checkpointed = withFilesCheckpoint(file, input.nextCheckpoint, resolution.bookmark);
            const providerItemIdentifier = resolveProviderItemIdentifier(checkpointed);
            const knownFile = providerItemIdentifier
              ? knownFilesIndex.get(providerItemIdentifier)
              : null;
            if (!knownFile || hasAppleBridgeRawObjectChanged(checkpointed, knownFile)) {
              delta.push(checkpointed);
            }
            break;
          }
          case 'reselect_required':
            for (const bookmarkId of resolution.stale_bookmark_ids) {
              staleBookmarkIds.add(bookmarkId);
            }
            break;
          case 'out_of_scope':
            break;
          default: {
            const _exhaustive: never = resolution;
            return _exhaustive;
          }
        }
      }

      if (staleBookmarkIds.size > 0) {
        return {
          status: 'reselect_required',
          error_code: 'reselect_required',
          stale_bookmark_ids: [...staleBookmarkIds],
          rawObjects: [],
        };
      }

      if (input.previousCheckpoint?.permission_state === 'limited') {
        const nextBookmarkIds = new Set(
          input.nextCheckpoint.selected_bookmarks.map((bookmark) => bookmark.bookmark_id),
        );
        const removedBookmarks = input.previousCheckpoint.selected_bookmarks.filter(
          (bookmark) => !nextBookmarkIds.has(bookmark.bookmark_id),
        );
        for (const file of input.knownFiles) {
          if (file.deleted) continue;
          const previousResolution = resolveAppleCompanionFileBookmark({
            identifiers: file.identifiers,
            selectedBookmarks: input.previousCheckpoint.selected_bookmarks,
          });
          if (previousResolution.status !== 'granted') {
            continue;
          }
          const removedBookmark = removedBookmarks.find(
            (bookmark) => bookmark.bookmark_id === previousResolution.bookmark.bookmark_id,
          );
          if (!removedBookmark) {
            continue;
          }
          delta.push(
            buildFilesTombstone(file, input.nextCheckpoint, removedBookmark, 'bookmark_removed'),
          );
        }
      }

      return {
        status: 'ready',
        rawObjects: uniqueRawObjectsByItemId(filterAppleBridgeFileRawObjectsForCurrentSelection(delta)),
      };
    }
    case 'denied':
    case 'not_determined':
    case 'full':
      return {
        status: 'ready',
        rawObjects: [],
      };
    default: {
      const _exhaustive: never = input.nextCheckpoint.permission_state;
      return _exhaustive;
    }
  }
}

export function buildApplePhotoLibrarySelectionDelta(
  input: ApplePhotoLibrarySelectionDeltaInput,
): AppleBridgeRawObject[] {
  const knownAssetIndex = buildPhotoLibraryAssetIndex(input.knownAssets);

  switch (input.nextCheckpoint.permission_state) {
    case 'limited': {
      const delta: AppleBridgeRawObject[] = [];
      for (const asset of input.currentAssets) {
        const checkpointed = withPhotoLibraryCheckpoint(asset, input.nextCheckpoint);
        if (
          !canIngestApplePhotoLibraryAsset({
            permissionState: input.nextCheckpoint.permission_state,
            identifiers: checkpointed.identifiers,
            selectedAssets: input.nextCheckpoint.selected_assets,
          })
        ) {
          continue;
        }
        const knownAsset = findPhotoLibraryAsset(knownAssetIndex, checkpointed);
        if (!knownAsset || hasAppleBridgeRawObjectChanged(checkpointed, knownAsset)) {
          delta.push(checkpointed);
        }
      }

      if (input.previousCheckpoint?.permission_state === 'limited') {
        for (const asset of input.knownAssets) {
          if (asset.deleted) continue;
          if (
            !matchesAppleCompanionSelectedAsset({
              identifiers: asset.identifiers,
              selectedAssets: input.previousCheckpoint.selected_assets,
            })
          ) {
            continue;
          }
          if (
            matchesAppleCompanionSelectedAsset({
              identifiers: asset.identifiers,
              selectedAssets: input.nextCheckpoint.selected_assets,
            })
          ) {
            continue;
          }
          delta.push(buildPhotoLibraryTombstone(asset, input.nextCheckpoint, 'selection_removed'));
        }
      }

      return uniqueRawObjectsByItemId(filterAppleBridgeRawObjectsForCurrentSelection(delta));
    }
    case 'denied':
    case 'not_determined':
      if (!input.previousCheckpoint || !hasPhotoLibraryAccess(input.previousCheckpoint.permission_state)) {
        return [];
      }
      return uniqueRawObjectsByItemId(
        input.knownAssets
          .filter((asset) => !asset.deleted)
          .map((asset) =>
            buildPhotoLibraryTombstone(asset, input.nextCheckpoint, 'permission_revoked'),
          ),
      );
    case 'full':
      // Slice 02 tracks the full-library state but must not expand into an implicit crawl.
      return [];
    default: {
      const _exhaustive: never = input.nextCheckpoint.permission_state;
      return _exhaustive;
    }
  }
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
    case 'video':
      return 'video/mp4';
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
        memoryType: input.rawObject.memory_type ?? null,
        needsCompanionProcessing: input.rawObject.needs_companion_processing ?? false,
        identifiers: input.rawObject.identifiers,
        itemId: input.rawObject.item_id,
        deleteLocalAfterAck: input.rawObject.delete_local_after_ack,
        photoLibraryCheckpoint: input.rawObject.photo_library_checkpoint ?? null,
        filesCheckpoint: input.rawObject.files_checkpoint ?? null,
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
      kind: 'photo',
      title: 'Removed limited-library asset',
      filename: 'IMG_1002.HEIC',
      mime_type: 'image/heic',
      observed_at: '2026-08-19T20:30:00.000Z',
      storage_mode: 'reference',
      sensitivity: 'personal',
      idempotency_key: 'apple-share/fixture-iphone/photo-2/selection_removed/photokit-change-1',
      delete_local_after_ack: false,
      process_now: false,
      source: 'photo_library',
      identifiers: {
        local_identifier: 'PHOTO-LOCAL-2',
        cloud_identifier: 'PHOTO-CLOUD-2',
      },
      metadata: {
        album: 'Camera Roll',
        photo_library_change_token: 'photokit-change-1',
        photoLibraryDeltaReason: 'selection_removed',
      },
      deleted: true,
      permissions: {
        photo_library: 'limited',
      },
      photo_library_checkpoint: {
        permission_state: 'limited',
        selected_assets: [],
        change_token: 'photokit-change-1',
      },
    },
    {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      device_id: 'fixture-iphone',
      connection_id: '88888888-8888-4888-8888-888888888899',
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
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

function buildIncrementalFixtures(input: {
  lastSeenExternalId: string | null;
  photoLibraryChangeToken: string | null;
}): AppleBridgeRawObject[] {
  if (
    input.photoLibraryChangeToken === 'photokit-change-2' ||
    input.lastSeenExternalId === 'URL-4'
  ) {
    return [];
  }
  return buildApplePhotoLibrarySelectionDelta({
    previousCheckpoint:
      input.photoLibraryChangeToken === 'photokit-change-1'
        ? {
            permission_state: 'limited',
            selected_assets: [],
            change_token: 'photokit-change-1',
          }
        : null,
    nextCheckpoint: {
      permission_state: 'limited',
      selected_assets: [{ provider_item_identifier: 'URL-4' }],
      change_token: 'photokit-change-2',
    },
    knownAssets: [],
    currentAssets: [
      {
        workspace_id: '11111111-1111-4111-8111-111111111111',
        project_id: '44444444-4444-4444-8444-444444444401',
        actor_subject_id: '33333333-3333-4333-8333-333333333301',
        device_id: 'fixture-mac',
        connection_id: '88888888-8888-4888-8888-888888888899',
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        kind: 'photo',
        title: 'Selected limited-library asset',
        url: 'https://example.com/apple-note-4',
        filename: 'IMG_1004.HEIC',
        mime_type: 'image/heic',
        observed_at: '2026-08-19T22:00:00.000Z',
        storage_mode: 'reference',
        sensitivity: 'internal',
        idempotency_key: 'apple-share/fixture-mac/url-4',
        delete_local_after_ack: true,
        process_now: false,
        source: 'photo_library',
        identifiers: {
          provider_item_identifier: 'URL-4',
        },
        metadata: {
          album: 'Selected imports',
        },
      },
    ],
  });
}

function resolveCursorExternalId(context: ConnectorSyncContext): string | null {
  return typeof context.cursor?.opaque.lastSeenExternalId === 'string'
    ? context.cursor.opaque.lastSeenExternalId
    : null;
}

function resolveCursorPhotoLibraryChangeToken(context: ConnectorSyncContext): string | null {
  return typeof context.cursor?.opaque[APPLE_PHOTO_LIBRARY_CHANGE_TOKEN_KEY] === 'string'
    ? String(context.cursor?.opaque[APPLE_PHOTO_LIBRARY_CHANGE_TOKEN_KEY])
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
        rawObjects: filterAppleBridgeRawObjectsForCurrentSelection(buildInitialFixtures()),
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
        rawObjects: filterAppleBridgeRawObjectsForCurrentSelection(
          buildIncrementalFixtures({
            lastSeenExternalId: resolveCursorExternalId(context),
            photoLibraryChangeToken: resolveCursorPhotoLibraryChangeToken(context),
          }),
        ),
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
        ...(newestRawObject.photo_library_checkpoint?.change_token
          ? {
              [APPLE_PHOTO_LIBRARY_CHANGE_TOKEN_KEY]:
                newestRawObject.photo_library_checkpoint.change_token,
            }
          : {}),
        ...(newestRawObject.files_checkpoint?.folder_checkpoints[0]?.change_token
          ? {
              [APPLE_FILES_CHANGE_TOKEN_KEY]:
                newestRawObject.files_checkpoint.folder_checkpoints[0].change_token,
            }
          : {}),
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

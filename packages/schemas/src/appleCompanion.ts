import { z } from 'zod';
import { sensitivitySchema, storageModeSchema } from './ingestion.js';
import { memoryStatusSchema, memoryTypeSchema } from './memory.js';

export const applePermissionStateSchema = z.enum([
  'not_determined',
  'limited',
  'full',
  'denied',
]);

export const appleCompanionPermissionSnapshotSchema = z.object({
  photo_library: applePermissionStateSchema.default('not_determined'),
  files: applePermissionStateSchema.default('not_determined'),
  share_extension: applePermissionStateSchema.default('not_determined'),
});

export const appleCompanionSourceSchema = z.enum([
  'companion_app',
  'share_extension',
  'document_picker',
  'photo_library',
  'manual',
]);

export const appleCompanionShareKindSchema = z.enum(['text', 'file', 'photo', 'video', 'url']);

export const appleCompanionItemKindSchema = appleCompanionShareKindSchema;

export const appleCompanionIdentifierSchema = z.object({
  local_identifier: z.string().min(1).optional(),
  cloud_identifier: z.string().min(1).optional(),
  provider_item_identifier: z.string().min(1).optional(),
});

export const appleCompanionSelectedAssetSchema = appleCompanionIdentifierSchema.superRefine(
  (value, ctx) => {
    if (
      !value.local_identifier &&
      !value.cloud_identifier &&
      !value.provider_item_identifier
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'selected assets require at least one durable identifier',
      });
    }
  },
);

export const appleCompanionPhotoLibraryCheckpointSchema = z.object({
  permission_state: applePermissionStateSchema.default('not_determined'),
  selected_assets: z.array(appleCompanionSelectedAssetSchema).default([]),
  change_token: z.string().min(1).nullable().default(null),
});

export const appleCompanionPhotoLibrarySelectionDeltaSchema = z.object({
  added: z.array(appleCompanionSelectedAssetSchema).default([]),
  removed: z.array(appleCompanionSelectedAssetSchema).default([]),
  updated: z.array(appleCompanionSelectedAssetSchema).default([]),
});

export const appleCompanionSelectionErrorCodeSchema = z.enum([
  'out_of_scope',
  'reselect_required',
]);

export const appleCompanionFileBookmarkSchema = z.object({
  bookmark_id: z.string().min(1),
  display_name: z.string().min(1),
  is_directory: z.boolean(),
  provider_item_identifier: z.string().min(1),
  security_scoped_bookmark: z.string().min(1),
  last_accessed_at: z.string().datetime().nullable().default(null),
  stale: z.boolean().default(false),
});

export const appleCompanionFolderMonitorCheckpointSchema = z.object({
  bookmark_id: z.string().min(1),
  provider_item_identifier: z.string().min(1),
  change_token: z.string().min(1).nullable().default(null),
});

export const appleCompanionFilesCheckpointSchema = z.object({
  permission_state: applePermissionStateSchema.default('not_determined'),
  selected_bookmarks: z.array(appleCompanionFileBookmarkSchema).default([]),
  folder_checkpoints: z.array(appleCompanionFolderMonitorCheckpointSchema).default([]),
});

export const appleCompanionFileBookmarkResolutionSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('granted'),
    bookmark: appleCompanionFileBookmarkSchema,
  }),
  z.object({
    status: z.literal('out_of_scope'),
    error_code: z.literal('out_of_scope'),
  }),
  z.object({
    status: z.literal('reselect_required'),
    error_code: z.literal('reselect_required'),
    stale_bookmark_ids: z.array(z.string().min(1)).min(1),
  }),
]);

export const appleCompanionProjectRefSchema = z.string().min(1);

export const appleCompanionTransferredObjectSourceSchema = z.enum([
  'companion_app',
  'share_extension',
  'document_picker',
  'photo_library',
]);

export const appleCompanionTransferredObjectsListQuerySchema = z
  .object({
    workspace_id: z.string().uuid(),
    project_id: appleCompanionProjectRefSchema,
    limit: z.coerce.number().int().positive().max(200).default(50),
  })
  .superRefine((value, ctx) => {
    if (!value.project_id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project_id'],
        message: 'project_id is required for this read',
      });
    }
  });

export const appleCompanionTransferredObjectSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().min(1),
  status: memoryStatusSchema,
  kind: appleCompanionItemKindSchema,
  source: appleCompanionTransferredObjectSourceSchema,
  sensitivity: sensitivitySchema,
  memory_type: memoryTypeSchema.nullable().default(null),
  source_event_id: z.string().uuid().nullable().default(null),
  device_id: z.string().min(1).nullable().default(null),
  connection_id: z.string().min(1).nullable().default(null),
  item_id: z.string().min(1).nullable().default(null),
  filename: z.string().min(1).nullable().default(null),
  canonical_reference: z.string().min(1).nullable().default(null),
  observed_at: z.string().datetime().nullable().default(null),
  recorded_at: z.string().datetime(),
  delete_local_after_ack: z.boolean().default(false),
  identifiers: appleCompanionIdentifierSchema.default({}),
});

export const appleCompanionTransferredObjectsListResponseSchema = z.object({
  objects: z.array(appleCompanionTransferredObjectSchema).default([]),
});

export const appleCompanionTransferredObjectDeleteRequestSchema = z
  .object({
    project_id: appleCompanionProjectRefSchema,
    actor_subject_id: z.string().uuid(),
    reason: z.string().min(1).max(2000),
  })
  .superRefine((value, ctx) => {
    if (!value.project_id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project_id'],
        message: 'project_id is required for this write',
      });
    }
  });

export const appleCompanionSharePayloadSchema = z
  .discriminatedUnion('kind', [
    z.object({
      workspace_id: z.string().uuid(),
      project_id: appleCompanionProjectRefSchema,
      actor_subject_id: z.string().uuid(),
      device_id: z.string().min(1),
      connection_id: z.string().uuid().optional(),
      item_id: z.string().uuid(),
      kind: z.literal('text'),
      title: z.string().min(1).optional(),
      text: z.string().min(1),
      observed_at: z.string().datetime().optional(),
      storage_mode: storageModeSchema,
      sensitivity: sensitivitySchema,
      memory_type: memoryTypeSchema.optional(),
      idempotency_key: z.string().min(1),
      delete_local_after_ack: z.boolean().default(false),
      identifiers: appleCompanionIdentifierSchema.default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    z.object({
      workspace_id: z.string().uuid(),
      project_id: appleCompanionProjectRefSchema,
      actor_subject_id: z.string().uuid(),
      device_id: z.string().min(1),
      connection_id: z.string().uuid().optional(),
      item_id: z.string().uuid(),
      kind: z.literal('url'),
      title: z.string().min(1).optional(),
      url: z.string().url(),
      observed_at: z.string().datetime().optional(),
      storage_mode: storageModeSchema,
      sensitivity: sensitivitySchema,
      memory_type: memoryTypeSchema.optional(),
      idempotency_key: z.string().min(1),
      delete_local_after_ack: z.boolean().default(false),
      identifiers: appleCompanionIdentifierSchema.default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    z.object({
      workspace_id: z.string().uuid(),
      project_id: appleCompanionProjectRefSchema,
      actor_subject_id: z.string().uuid(),
      device_id: z.string().min(1),
      connection_id: z.string().uuid().optional(),
      item_id: z.string().uuid(),
      kind: z.literal('photo'),
      title: z.string().min(1).optional(),
      filename: z.string().min(1),
      mime_type: z.string().min(1).optional(),
      observed_at: z.string().datetime().optional(),
      storage_mode: storageModeSchema,
      sensitivity: sensitivitySchema,
      memory_type: memoryTypeSchema.optional(),
      idempotency_key: z.string().min(1),
      delete_local_after_ack: z.boolean().default(false),
      identifiers: appleCompanionIdentifierSchema.default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    z.object({
      workspace_id: z.string().uuid(),
      project_id: appleCompanionProjectRefSchema,
      actor_subject_id: z.string().uuid(),
      device_id: z.string().min(1),
      connection_id: z.string().uuid().optional(),
      item_id: z.string().uuid(),
      kind: z.literal('video'),
      title: z.string().min(1).optional(),
      filename: z.string().min(1),
      mime_type: z.string().min(1).optional(),
      observed_at: z.string().datetime().optional(),
      storage_mode: storageModeSchema,
      sensitivity: sensitivitySchema,
      memory_type: memoryTypeSchema.optional(),
      idempotency_key: z.string().min(1),
      delete_local_after_ack: z.boolean().default(false),
      identifiers: appleCompanionIdentifierSchema.default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
    z.object({
      workspace_id: z.string().uuid(),
      project_id: appleCompanionProjectRefSchema,
      actor_subject_id: z.string().uuid(),
      device_id: z.string().min(1),
      connection_id: z.string().uuid().optional(),
      item_id: z.string().uuid(),
      kind: z.literal('file'),
      title: z.string().min(1).optional(),
      filename: z.string().min(1),
      mime_type: z.string().min(1).optional(),
      observed_at: z.string().datetime().optional(),
      storage_mode: storageModeSchema,
      sensitivity: sensitivitySchema,
      memory_type: memoryTypeSchema.optional(),
      idempotency_key: z.string().min(1),
      delete_local_after_ack: z.boolean().default(false),
      identifiers: appleCompanionIdentifierSchema.default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  ])
  .superRefine((value, ctx) => {
    if (!value.project_id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['project_id'],
        message: 'project_id is required for this write',
      });
    }
  });

export const appleCompanionIngestRequestSchema = z
  .object({
    workspace_id: z.string().uuid(),
    project_id: appleCompanionProjectRefSchema,
    actor_subject_id: z.string().uuid(),
    device_id: z.string().min(1),
    connection_id: z.string().uuid().optional(),
    item_id: z.string().uuid(),
    kind: appleCompanionItemKindSchema,
    title: z.string().min(1),
    text: z.string().optional(),
    url: z.string().url().optional(),
    filename: z.string().min(1).optional(),
    mime_type: z.string().min(1).optional(),
    observed_at: z.string().datetime().optional(),
    external_version: z.string().min(1).optional(),
    storage_mode: storageModeSchema.default('reference'),
    sensitivity: sensitivitySchema.default('internal'),
    memory_type: memoryTypeSchema.optional(),
    idempotency_key: z.string().min(1),
    delete_local_after_ack: z.boolean().default(false),
    process_now: z.boolean().default(false),
    needs_companion_processing: z.boolean().default(false),
    source: appleCompanionSourceSchema.default('companion_app'),
    identifiers: appleCompanionIdentifierSchema.default({}),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'text' && (!value.text || value.text.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'text is required for text items',
      });
    }
    if (value.kind === 'url' && !value.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'url is required for url items',
      });
    }
    if ((value.kind === 'file' || value.kind === 'photo' || value.kind === 'video') && !value.filename) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filename'],
        message: 'filename is required for file, photo, and video items',
      });
    }
  });

export const appleCompanionQueueStateSchema = z.enum([
  'pending',
  'uploading',
  'failed',
  'done',
]);

export const appleCompanionVisibleQueueStateSchema = z.enum([
  'pending',
  'uploading',
  'failed',
  'done',
  'reselect_required',
]);

export const appleCompanionQueueErrorCodeSchema = z.enum(['reselect_required']);

function resolveAppleCompanionQueueStatusLabel(input: {
  state: AppleCompanionQueueState;
  last_error_code: AppleCompanionQueueErrorCode | null;
}): AppleCompanionVisibleQueueState {
  if (input.last_error_code === 'reselect_required') {
    return 'reselect_required';
  }
  return input.state;
}

export const appleCompanionQueueItemSchema = z
  .object({
    id: z.string().uuid(),
    state: appleCompanionQueueStateSchema.default('pending'),
    status_label: appleCompanionVisibleQueueStateSchema.optional(),
    attempt_count: z.number().int().nonnegative().default(0),
    payload: appleCompanionIngestRequestSchema,
    delete_local_after_ack: z.boolean().default(false),
    last_error: z.string().nullable().default(null),
    last_error_code: appleCompanionQueueErrorCodeSchema.nullable().default(null),
    queued_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    last_attempt_at: z.string().datetime().nullable().default(null),
    next_retry_at: z.string().datetime().nullable().default(null),
    completed_at: z.string().datetime().nullable().default(null),
  })
  .transform((item) => ({
    ...item,
    status_label: resolveAppleCompanionQueueStatusLabel({
      state: item.state,
      last_error_code: item.last_error_code,
    }),
  }));

export const appleCompanionQueueDrainResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('acknowledged'),
    delete_local_after_ack: z.boolean().optional(),
  }),
  z.object({
    status: z.literal('network_error'),
    error: z.string().min(1),
    retry_delay_ms: z.number().int().nonnegative().default(60_000),
  }),
  z.object({
    status: z.literal('validation_error'),
    error: z.string().min(1),
    http_status: z.number().int().default(400),
  }),
  z.object({
    status: z.literal('reselect_required'),
    error: z.string().min(1).default('reselect_required'),
  }),
]);

export const appleCompanionQueueSchema = z.array(appleCompanionQueueItemSchema);

export const appleCompanionDeviceQueueCursorSchema = z.object({
  photo_library: appleCompanionPhotoLibraryCheckpointSchema.optional(),
  files: appleCompanionFilesCheckpointSchema.optional(),
});

export const appleCompanionQueueSnapshotSchema = z.object({
  items: appleCompanionQueueSchema.default([]),
  cursor: appleCompanionDeviceQueueCursorSchema.default({}),
});

export type ApplePermissionState = z.infer<typeof applePermissionStateSchema>;
export type AppleCompanionPermissionSnapshot = z.infer<
  typeof appleCompanionPermissionSnapshotSchema
>;
export type AppleCompanionSource = z.infer<typeof appleCompanionSourceSchema>;
export type AppleCompanionShareKind = z.infer<typeof appleCompanionShareKindSchema>;
export type AppleCompanionItemKind = z.infer<typeof appleCompanionItemKindSchema>;
export type AppleCompanionIdentifier = z.infer<typeof appleCompanionIdentifierSchema>;
export type AppleCompanionSelectedAsset = z.infer<typeof appleCompanionSelectedAssetSchema>;
export type AppleCompanionPhotoLibraryCheckpoint = z.infer<
  typeof appleCompanionPhotoLibraryCheckpointSchema
>;
export type AppleCompanionPhotoLibrarySelectionDelta = z.infer<
  typeof appleCompanionPhotoLibrarySelectionDeltaSchema
>;
export type AppleCompanionSelectionErrorCode = z.infer<
  typeof appleCompanionSelectionErrorCodeSchema
>;
export type AppleCompanionFileBookmark = z.infer<typeof appleCompanionFileBookmarkSchema>;
export type AppleCompanionFolderMonitorCheckpoint = z.infer<
  typeof appleCompanionFolderMonitorCheckpointSchema
>;
export type AppleCompanionFilesCheckpoint = z.infer<typeof appleCompanionFilesCheckpointSchema>;
export type AppleCompanionFileBookmarkResolution = z.infer<
  typeof appleCompanionFileBookmarkResolutionSchema
>;
export type AppleCompanionSharePayload = z.infer<typeof appleCompanionSharePayloadSchema>;
export type AppleCompanionIngestRequest = z.infer<typeof appleCompanionIngestRequestSchema>;
export type AppleCompanionTransferredObjectSource = z.infer<
  typeof appleCompanionTransferredObjectSourceSchema
>;
export type AppleCompanionTransferredObjectsListQuery = z.infer<
  typeof appleCompanionTransferredObjectsListQuerySchema
>;
export type AppleCompanionTransferredObject = z.infer<
  typeof appleCompanionTransferredObjectSchema
>;
export type AppleCompanionTransferredObjectsListResponse = z.infer<
  typeof appleCompanionTransferredObjectsListResponseSchema
>;
export type AppleCompanionTransferredObjectDeleteRequest = z.infer<
  typeof appleCompanionTransferredObjectDeleteRequestSchema
>;
export type AppleCompanionQueueState = z.infer<typeof appleCompanionQueueStateSchema>;
export type AppleCompanionVisibleQueueState = z.infer<
  typeof appleCompanionVisibleQueueStateSchema
>;
export type AppleCompanionQueueErrorCode = z.infer<typeof appleCompanionQueueErrorCodeSchema>;
export type AppleCompanionQueueItem = z.infer<typeof appleCompanionQueueItemSchema>;
export type AppleCompanionQueueDrainResult = z.infer<typeof appleCompanionQueueDrainResultSchema>;
export type AppleCompanionDeviceQueueCursor = z.infer<
  typeof appleCompanionDeviceQueueCursorSchema
>;
export type AppleCompanionQueueSnapshot = z.infer<typeof appleCompanionQueueSnapshotSchema>;

export type AppleCompanionSecurityScopedLease = {
  bookmark_id: string;
  stopAccessing: () => void;
};

export type AppleCompanionSecurityScopedLeaseStarter = (
  bookmark: AppleCompanionFileBookmark,
) => AppleCompanionSecurityScopedLease;

export type AppleCompanionShareMapping = {
  request: AppleCompanionIngestRequest;
  queueItem: AppleCompanionQueueItem;
};

export type AppleCompanionQueueDrainTransport = (
  item: AppleCompanionQueueItem,
) => Promise<AppleCompanionQueueDrainResult> | AppleCompanionQueueDrainResult;

function uniqueNonEmptyStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function normalizeAppleCompanionProviderItemIdentifier(value: string): string {
  if (value === '/') return value;
  return value.replace(/\/+$/, '');
}

function resolveAppleCompanionShareTitle(share: AppleCompanionSharePayload): string {
  if (share.title?.trim()) {
    return share.title.trim();
  }
  const kind = share.kind;
  switch (kind) {
    case 'text':
      return share.text.trim().slice(0, 120) || 'Shared text';
    case 'url':
      return share.url;
    case 'photo':
    case 'video':
    case 'file':
      return share.filename;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function isAppleCompanionQueueItemRetryReady(
  item: AppleCompanionQueueItem,
  nowIso: string,
): boolean {
  if (item.state !== 'failed') {
    return false;
  }
  if (item.last_error_code === 'reselect_required') {
    return false;
  }
  if (!item.next_retry_at) {
    return false;
  }
  return Date.parse(item.next_retry_at) <= Date.parse(nowIso);
}

export function listAppleCompanionIdentifierCandidates(
  identifiers: AppleCompanionIdentifier | AppleCompanionSelectedAsset,
): string[] {
  return uniqueNonEmptyStrings([
    identifiers.local_identifier,
    identifiers.cloud_identifier,
    identifiers.provider_item_identifier,
  ]);
}

export function buildAppleCompanionSelectedAssetIndex(
  selectedAssets: AppleCompanionSelectedAsset[],
): Set<string> {
  const index = new Set<string>();
  for (const asset of selectedAssets) {
    for (const key of listAppleCompanionIdentifierCandidates(asset)) {
      index.add(key);
    }
  }
  return index;
}

export function matchesAppleCompanionSelectedAsset(input: {
  identifiers: AppleCompanionIdentifier;
  selectedAssets: AppleCompanionSelectedAsset[];
}): boolean {
  const selectedAssetIndex = buildAppleCompanionSelectedAssetIndex(input.selectedAssets);
  return listAppleCompanionIdentifierCandidates(input.identifiers).some((key) =>
    selectedAssetIndex.has(key),
  );
}

export function matchesAppleCompanionFileBookmarkScope(input: {
  providerItemIdentifier: string;
  bookmark: AppleCompanionFileBookmark;
}): boolean {
  const bookmarkIdentifier = normalizeAppleCompanionProviderItemIdentifier(
    input.bookmark.provider_item_identifier,
  );
  const itemIdentifier = normalizeAppleCompanionProviderItemIdentifier(input.providerItemIdentifier);
  if (bookmarkIdentifier === itemIdentifier) {
    return true;
  }
  if (!input.bookmark.is_directory) {
    return false;
  }
  if (bookmarkIdentifier === '/') {
    return itemIdentifier.startsWith('/');
  }
  return itemIdentifier.startsWith(`${bookmarkIdentifier}/`);
}

export function resolveAppleCompanionFileBookmark(input: {
  identifiers: AppleCompanionIdentifier;
  selectedBookmarks: AppleCompanionFileBookmark[];
}): AppleCompanionFileBookmarkResolution {
  const providerItemIdentifier = input.identifiers.provider_item_identifier?.trim();
  if (!providerItemIdentifier) {
    return appleCompanionFileBookmarkResolutionSchema.parse({
      status: 'out_of_scope',
      error_code: 'out_of_scope',
    });
  }

  const matchingBookmarks = input.selectedBookmarks.filter((bookmark) =>
    matchesAppleCompanionFileBookmarkScope({
      providerItemIdentifier,
      bookmark,
    }),
  );
  const grantedBookmark = matchingBookmarks.find((bookmark) => !bookmark.stale);
  if (grantedBookmark) {
    return appleCompanionFileBookmarkResolutionSchema.parse({
      status: 'granted',
      bookmark: grantedBookmark,
    });
  }
  if (matchingBookmarks.length > 0) {
    return appleCompanionFileBookmarkResolutionSchema.parse({
      status: 'reselect_required',
      error_code: 'reselect_required',
      stale_bookmark_ids: matchingBookmarks.map((bookmark) => bookmark.bookmark_id),
    });
  }
  return appleCompanionFileBookmarkResolutionSchema.parse({
    status: 'out_of_scope',
    error_code: 'out_of_scope',
  });
}

export function canIngestAppleCompanionFile(input: {
  identifiers: AppleCompanionIdentifier;
  selectedBookmarks?: AppleCompanionFileBookmark[];
}): boolean {
  const selectedBookmarks = input.selectedBookmarks ?? [];
  return resolveAppleCompanionFileBookmark({
    identifiers: input.identifiers,
    selectedBookmarks,
  }).status === 'granted';
}

export function canIngestApplePhotoLibraryAsset(input: {
  permissionState: ApplePermissionState;
  identifiers: AppleCompanionIdentifier;
  selectedAssets?: AppleCompanionSelectedAsset[];
}): boolean {
  const selectedAssets = input.selectedAssets ?? [];
  switch (input.permissionState) {
    case 'limited':
      return matchesAppleCompanionSelectedAsset({
        identifiers: input.identifiers,
        selectedAssets,
      });
    case 'full':
      // Slice 02 represents full access but must not expand into an implicit full-library ingest.
      return false;
    case 'denied':
    case 'not_determined':
      return false;
    default: {
      const _exhaustive: never = input.permissionState;
      return _exhaustive;
    }
  }
}

export function mapAppleCompanionSharePayload(input: {
  share: AppleCompanionSharePayload;
  queuedAt?: string;
}): AppleCompanionShareMapping {
  const share = appleCompanionSharePayloadSchema.parse(input.share);
  const request = appleCompanionIngestRequestSchema.parse({
    ...share,
    title: resolveAppleCompanionShareTitle(share),
    process_now: false,
    needs_companion_processing: true,
    source: 'share_extension',
  });
  return {
    request,
    queueItem: createAppleCompanionQueueItem({
      payload: request,
      queuedAt: input.queuedAt,
    }),
  };
}

export function createAppleCompanionQueueItem(input: {
  payload: AppleCompanionIngestRequest;
  queuedAt?: string;
}): AppleCompanionQueueItem {
  const queuedAt = input.queuedAt ?? new Date().toISOString();
  return appleCompanionQueueItemSchema.parse({
    id: input.payload.item_id,
    state: 'pending',
    attempt_count: 0,
    payload: input.payload,
    delete_local_after_ack: input.payload.delete_local_after_ack,
    last_error: null,
    last_error_code: null,
    queued_at: queuedAt,
    updated_at: queuedAt,
    last_attempt_at: null,
    next_retry_at: null,
    completed_at: null,
  });
}

export function markAppleCompanionQueueItemUploading(
  queue: AppleCompanionQueueItem[],
  itemId: string,
  attemptedAt = new Date().toISOString(),
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            state: 'uploading',
            updated_at: attemptedAt,
            last_attempt_at: attemptedAt,
            last_error: null,
            last_error_code: null,
          }
        : item,
    ),
  );
}

function setAppleCompanionQueueItemDeleteLocalAfterAck(
  queue: AppleCompanionQueueItem[],
  itemId: string,
  deleteLocalAfterAck: boolean,
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            delete_local_after_ack: deleteLocalAfterAck,
          }
        : item,
    ),
  );
}

export function markAppleCompanionQueueItemFailed(
  queue: AppleCompanionQueueItem[],
  itemId: string,
  errorMessage: string,
  failedAt = new Date().toISOString(),
  retryDelayMs: number | null = 60_000,
  errorCode: AppleCompanionQueueErrorCode | null = null,
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            state: 'failed',
            attempt_count: item.attempt_count + 1,
            updated_at: failedAt,
            last_attempt_at: failedAt,
            last_error: errorMessage,
            last_error_code: errorCode,
            next_retry_at:
              retryDelayMs === null ? null : new Date(Date.parse(failedAt) + retryDelayMs).toISOString(),
          }
        : item,
    ),
  );
}

export function markAppleCompanionQueueItemReselectRequired(
  queue: AppleCompanionQueueItem[],
  itemId: string,
  failedAt = new Date().toISOString(),
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            state: 'failed',
            attempt_count: item.attempt_count + 1,
            updated_at: failedAt,
            last_attempt_at: failedAt,
            last_error: 'reselect_required',
            last_error_code: 'reselect_required',
            next_retry_at: null,
          }
        : item,
    ),
  );
}

export function markAppleCompanionQueueItemDone(
  queue: AppleCompanionQueueItem[],
  itemId: string,
  completedAt = new Date().toISOString(),
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(
    queue.map((item) =>
      item.id === itemId
        ? {
            ...item,
            state: 'done',
            updated_at: completedAt,
            completed_at: completedAt,
            next_retry_at: null,
            last_error: null,
            last_error_code: null,
          }
        : item,
    ),
  );
}

export function acknowledgeAppleCompanionQueueItem(
  queue: AppleCompanionQueueItem[],
  itemId: string,
): AppleCompanionQueueItem[] {
  return appleCompanionQueueSchema.parse(queue.filter((item) => item.id !== itemId));
}

export async function drainAppleCompanionQueue(input: {
  queue: AppleCompanionQueueItem[];
  transport: AppleCompanionQueueDrainTransport;
  now?: string;
  limit?: number;
}): Promise<AppleCompanionQueueItem[]> {
  const now = input.now ?? new Date().toISOString();
  let nextQueue = appleCompanionQueueSchema.parse(input.queue);
  let processed = 0;

  for (const item of nextQueue) {
    if (input.limit !== undefined && processed >= input.limit) {
      break;
    }
    const shouldDrain =
      item.state === 'pending' || isAppleCompanionQueueItemRetryReady(item, now);
    if (!shouldDrain) {
      continue;
    }

    processed += 1;
    nextQueue = markAppleCompanionQueueItemUploading(nextQueue, item.id, now);
    const uploadingItem = nextQueue.find((queuedItem) => queuedItem.id === item.id);
    if (!uploadingItem) {
      continue;
    }

    const result = appleCompanionQueueDrainResultSchema.parse(await input.transport(uploadingItem));
    switch (result.status) {
      case 'acknowledged': {
        if (result.delete_local_after_ack !== undefined) {
          nextQueue = setAppleCompanionQueueItemDeleteLocalAfterAck(
            nextQueue,
            item.id,
            result.delete_local_after_ack,
          );
        }
        nextQueue = markAppleCompanionQueueItemDone(nextQueue, item.id, now);
        break;
      }
      case 'network_error':
        nextQueue = markAppleCompanionQueueItemFailed(
          nextQueue,
          item.id,
          result.error,
          now,
          result.retry_delay_ms,
        );
        break;
      case 'validation_error':
        nextQueue = markAppleCompanionQueueItemFailed(nextQueue, item.id, result.error, now, null);
        break;
      case 'reselect_required':
        nextQueue = markAppleCompanionQueueItemReselectRequired(nextQueue, item.id, now);
        break;
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  return nextQueue;
}

export async function withAppleCompanionSecurityScopedLease<T>(input: {
  bookmark: AppleCompanionFileBookmark;
  startAccessing: AppleCompanionSecurityScopedLeaseStarter;
  read: (lease: AppleCompanionSecurityScopedLease) => Promise<T> | T;
}): Promise<T> {
  const lease = input.startAccessing(input.bookmark);
  try {
    return await input.read(lease);
  } finally {
    lease.stopAccessing();
  }
}

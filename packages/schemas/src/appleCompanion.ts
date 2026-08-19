import { z } from 'zod';
import { sensitivitySchema, storageModeSchema } from './ingestion.js';

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

export const appleCompanionItemKindSchema = z.enum(['text', 'file', 'photo', 'url']);

export const appleCompanionIdentifierSchema = z.object({
  local_identifier: z.string().min(1).optional(),
  cloud_identifier: z.string().min(1).optional(),
  provider_item_identifier: z.string().min(1).optional(),
});

export const appleCompanionProjectRefSchema = z.string().min(1);

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
    idempotency_key: z.string().min(1),
    delete_local_after_ack: z.boolean().default(false),
    process_now: z.boolean().default(false),
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
    if ((value.kind === 'file' || value.kind === 'photo') && !value.filename) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filename'],
        message: 'filename is required for file and photo items',
      });
    }
  });

export const appleCompanionQueueStateSchema = z.enum([
  'pending',
  'uploading',
  'failed',
  'done',
]);

export const appleCompanionQueueItemSchema = z.object({
  id: z.string().uuid(),
  state: appleCompanionQueueStateSchema.default('pending'),
  attempt_count: z.number().int().nonnegative().default(0),
  payload: appleCompanionIngestRequestSchema,
  delete_local_after_ack: z.boolean().default(false),
  last_error: z.string().nullable().default(null),
  queued_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_attempt_at: z.string().datetime().nullable().default(null),
  next_retry_at: z.string().datetime().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
});

export const appleCompanionQueueSchema = z.array(appleCompanionQueueItemSchema);

export type ApplePermissionState = z.infer<typeof applePermissionStateSchema>;
export type AppleCompanionPermissionSnapshot = z.infer<
  typeof appleCompanionPermissionSnapshotSchema
>;
export type AppleCompanionSource = z.infer<typeof appleCompanionSourceSchema>;
export type AppleCompanionItemKind = z.infer<typeof appleCompanionItemKindSchema>;
export type AppleCompanionIdentifier = z.infer<typeof appleCompanionIdentifierSchema>;
export type AppleCompanionIngestRequest = z.infer<typeof appleCompanionIngestRequestSchema>;
export type AppleCompanionQueueState = z.infer<typeof appleCompanionQueueStateSchema>;
export type AppleCompanionQueueItem = z.infer<typeof appleCompanionQueueItemSchema>;

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
  retryDelayMs = 60_000,
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
            next_retry_at: new Date(Date.parse(failedAt) + retryDelayMs).toISOString(),
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

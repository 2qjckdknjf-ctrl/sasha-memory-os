import { z } from 'zod';

export const sensitivitySchema = z.enum([
  'public',
  'internal',
  'personal',
  'confidential',
  'restricted',
]);

export const storageModeSchema = z.enum(['reference', 'indexed', 'archived']);

export const ingestionEnvelopeSchema = z.object({
  schema_version: z.literal('1.0'),
  workspace_id: z.string().uuid(),
  source: z.object({
    provider: z.string().min(1),
    account_id: z.string().uuid().optional(),
    external_id: z.string().min(1).optional(),
    external_version: z.string().optional(),
  }),
  event_type: z.string().min(1),
  observed_at: z.string().datetime(),
  idempotency_key: z.string().min(1),
  content: z
    .object({
      mime_type: z.string().optional(),
      reference: z.string().optional(),
      checksum: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  scope: z
    .object({
      project_id: z.string().uuid().optional(),
      sensitivity: sensitivitySchema.default('internal'),
      storage_mode: storageModeSchema.default('reference'),
    })
    .default({ sensitivity: 'internal', storage_mode: 'reference' }),
  provenance: z.record(z.string(), z.unknown()).default({}),
});

export type IngestionEnvelope = z.infer<typeof ingestionEnvelopeSchema>;

export const captureTextSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  title: z.string().min(1),
  text: z.string().min(1),
  sensitivity: sensitivitySchema.default('internal'),
  actor_subject_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  process_now: z.boolean().default(true),
});

export type CaptureTextInput = z.infer<typeof captureTextSchema>;

export const captureDocumentSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  title: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().optional(),
  content_base64: z.string().min(1),
  sensitivity: sensitivitySchema.default('internal'),
  actor_subject_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  process_now: z.boolean().default(true),
});

export type CaptureDocumentInput = z.infer<typeof captureDocumentSchema>;

export const captureLinkSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  url: z.string().url(),
  title: z.string().min(1).optional(),
  sensitivity: sensitivitySchema.default('internal'),
  actor_subject_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
  process_now: z.boolean().default(true),
});

export type CaptureLinkInput = z.infer<typeof captureLinkSchema>;

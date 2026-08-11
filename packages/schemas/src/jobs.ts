import { z } from 'zod';

export const processingJobTypeSchema = z.enum([
  'parse',
  'ocr',
  'embed',
  'extract',
  'consolidate',
  'ingest',
]);

export const processingJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
]);

export const outboxEventSchema = z.object({
  workspace_id: z.string().uuid(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().uuid(),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const enqueueJobSchema = z.object({
  workspace_id: z.string().uuid(),
  job_type: processingJobTypeSchema,
  idempotency_key: z.string().min(1),
  source_event_id: z.string().uuid().optional(),
});

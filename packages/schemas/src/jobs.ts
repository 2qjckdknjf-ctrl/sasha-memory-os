import { z } from 'zod';

export const processingJobTypeSchema = z.enum([
  'parse',
  'ocr',
  'embed',
  'extract',
  'consolidate',
  'ingest',
  'connector_sync',
  'roma_project_health',
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

export const enqueueRomaProjectHealthJobSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  idempotency_key: z.string().min(1).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const replayConnectorJobSchema = z.object({
  actor_subject_id: z.string().uuid(),
  resync: z.boolean().optional(),
});

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
  'roma_project_findings',
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

export const enqueueRomaProjectFindingsJobSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  actor_subject_id: z.string().uuid(),
  idempotency_key: z.string().min(1).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const upsertRomaProjectHealthScheduleSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  actor_subject_id: z.string().uuid(),
  cadence_minutes: z.number().int().min(1).max(10080),
  enabled: z.boolean().optional(),
  next_run_at: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export const upsertRomaActionBudgetSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  actor_subject_id: z.string().uuid(),
  max_actions: z.number().int().min(1).max(100000),
  window_minutes: z.number().int().min(1).max(10080),
  enabled: z.boolean().optional(),
});

export const replayConnectorJobSchema = z.object({
  actor_subject_id: z.string().uuid(),
  resync: z.boolean().optional(),
});

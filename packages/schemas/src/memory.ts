import { z } from 'zod';
import { sensitivitySchema } from './ingestion.js';

export const memoryTypeSchema = z.enum([
  'fact',
  'preference',
  'idea',
  'decision',
  'task',
  'event',
  'state',
  'handoff',
]);

export const memoryStatusSchema = z.enum([
  'candidate',
  'active',
  'verified',
  'disputed',
  'superseded',
  'retracted',
  'deleted',
]);

export const memoryRecordSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable().optional(),
  memory_type: memoryTypeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  status: memoryStatusSchema,
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  sensitivity: sensitivitySchema,
  valid_from: z.string().datetime().nullable().optional(),
  valid_to: z.string().datetime().nullable().optional(),
  observed_at: z.string().datetime().nullable().optional(),
  recorded_at: z.string().datetime(),
  superseded_by: z.string().uuid().nullable().optional(),
  source_event_id: z.string().uuid().nullable().optional(),
  created_by_subject: z.string().uuid().nullable().optional(),
  schema_version: z.string().default('1.0'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createDecisionSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  title: z.string().min(1),
  content: z.string().min(1),
  rationale: z.string().optional(),
  decision_maker: z.string().optional(),
  effective_at: z.string().datetime().optional(),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.9),
  sensitivity: sensitivitySchema.default('internal'),
  idempotency_key: z.string().min(1),
  actor_subject_id: z.string().uuid(),
});

export const projectStateSchema = z.object({
  stage: z.string(),
  completed: z.array(z.string()).default([]),
  in_progress: z.array(z.string()).default([]),
  blocked: z.array(z.string()).default([]),
  next: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  active_decisions: z.array(z.string().uuid()).default([]),
});

export const upsertProjectStateSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid(),
  expected_version: z.number().int().nonnegative(),
  state: projectStateSchema,
  summary: z.string().optional(),
  actor_subject_id: z.string().uuid(),
  idempotency_key: z.string().min(1),
});

export const createHandoffSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  from_subject_id: z.string().uuid(),
  to_subject_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  payload: z.object({
    completed: z.array(z.string()).default([]),
    artifacts: z.array(z.record(z.string(), z.unknown())).default([]),
    validation: z.array(z.string()).default([]),
    open_items: z.array(z.string()).default([]),
    blockers: z.array(z.string()).default([]),
    recommended_next: z.array(z.string()).default([]),
  }),
  idempotency_key: z.string().min(1),
});

export const setMemoryStatusSchema = z.object({
  status: memoryStatusSchema,
  reason: z.string().min(1).max(2000),
  actor_subject_id: z.string().uuid(),
});

export const memoryPersonalizationScopeSchema = z.enum([
  'actor',
  'project_default',
]);

export const setMemoryPersonalizationSchema = z
  .object({
    project_id: z.string().uuid(),
    scope: memoryPersonalizationScopeSchema.default('actor'),
    reason: z.string().min(1).max(2000),
    actor_subject_id: z.string().uuid(),
    pinned: z.boolean().optional(),
    importance_delta: z.number().min(-0.5).max(0.5).nullable().optional(),
  });

export const correctMemorySchema = z
  .object({
    actor_subject_id: z.string().uuid(),
    reason: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).max(4000).optional(),
    replacement_memory_id: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const hasReplacement = value.replacement_memory_id !== undefined;
    const hasContentUpdate = value.content !== undefined;
    const hasTitleUpdate = value.title !== undefined;
    if (!hasReplacement && !hasContentUpdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'content is required when replacement_memory_id is not provided',
        path: ['content'],
      });
    }
    if (hasReplacement && (hasContentUpdate || hasTitleUpdate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'replacement_memory_id cannot be combined with title or content',
        path: ['replacement_memory_id'],
      });
    }
  });

export const privacyRequestTypeSchema = z.enum([
  'deletion',
  'correction',
  'retraction',
]);

export const createPrivacyRequestSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  actor_subject_id: z.string().uuid(),
  request_type: privacyRequestTypeSchema,
  target_memory_id: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000),
  correction_text: z.string().max(4000).optional(),
  idempotency_key: z.string().min(1).max(200),
});

export const extractionCandidateSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(4000),
  memoryType: z
    .enum(['fact', 'decision', 'preference', 'idea', 'task', 'event'])
    .default('fact'),
  confidence: z.number().min(0).max(1).default(0.5),
});

/** Persist extraction preview candidates as memories (decisions or capture→candidate). */
export const applyExtractionSchema = z.object({
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  actor_subject_id: z.string().uuid(),
  sensitivity: sensitivitySchema.default('internal'),
  idempotency_prefix: z.string().min(1).max(200),
  candidates: z.array(extractionCandidateSchema).min(1).max(8),
});

export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;
export type UpsertProjectStateInput = z.infer<typeof upsertProjectStateSchema>;
export type CreateHandoffInput = z.infer<typeof createHandoffSchema>;
export type SetMemoryStatusInput = z.infer<typeof setMemoryStatusSchema>;
export type SetMemoryPersonalizationInput = z.infer<
  typeof setMemoryPersonalizationSchema
>;
export type CorrectMemoryInput = z.infer<typeof correctMemorySchema>;
export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;
export type ApplyExtractionInput = z.infer<typeof applyExtractionSchema>;

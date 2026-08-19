import { z } from 'zod';

export const connectionStatusSchema = z.enum([
  'connected',
  'degraded',
  'reauth_required',
  'revoked',
  'disabled',
]);

export const upsertConnectionSchema = z.object({
  workspace_id: z.string().uuid(),
  connector_id: z.string().min(1),
  display_name: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  status: connectionStatusSchema.default('connected'),
  actor_subject_id: z.string().uuid(),
});

export const setConnectionStatusSchema = z.object({
  status: connectionStatusSchema,
  last_error: z.string().nullable().optional(),
  actor_subject_id: z.string().uuid(),
});

export const revokeConnectionSchema = z.object({
  actor_subject_id: z.string().uuid(),
});

export type UpsertConnectionInput = z.infer<typeof upsertConnectionSchema>;
export type SetConnectionStatusInput = z.infer<typeof setConnectionStatusSchema>;
export type RevokeConnectionInput = z.infer<typeof revokeConnectionSchema>;

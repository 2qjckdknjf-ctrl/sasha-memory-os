import { z } from 'zod';

export const oauthStartSchema = z.object({
  workspace_id: z.string().uuid(),
  connector_id: z.string().min(1),
  display_name: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  redirect_uri: z.string().url().optional(),
  actor_subject_id: z.string().uuid(),
});

export const oauthCompleteSchema = z.object({
  state: z.string().min(1),
  code: z.string().optional(),
  actor_subject_id: z.string().uuid(),
});

export const bindAuthUserSchema = z.object({
  workspace_id: z.string().uuid(),
  auth_user_id: z.string().uuid(),
  email: z.string().email().optional(),
  display_name: z.string().min(1).optional(),
  acting_subject_id: z.string().uuid().optional(),
});

export type OAuthStartInput = z.infer<typeof oauthStartSchema>;
export type OAuthCompleteInput = z.infer<typeof oauthCompleteSchema>;
export type BindAuthUserInput = z.infer<typeof bindAuthUserSchema>;

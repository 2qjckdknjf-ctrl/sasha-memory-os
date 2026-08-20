import { z } from 'zod';

export const connectionStatusSchema = z.enum([
  'connected',
  'degraded',
  'reauth_required',
  'revoked',
  'disabled',
]);

export const connectorCollectionKindSchema = z.enum([
  'collection',
  'repository',
  'folder',
  'calendar',
  'label',
]);

export const connectorCollectionSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().min(1).optional(),
  kind: connectorCollectionKindSchema.default('collection'),
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().url().optional(),
  description: z.string().nullable().optional(),
  default_branch: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const connectorCollectionsStateSchema = z.object({
  selection_mode: z.literal('all').default('all'),
  excluded_ids: z.array(z.string()).default([]),
  items: z.array(connectorCollectionSchema).default([]),
  discovered_at: z.string().datetime({ offset: true }).nullish(),
  synced_at: z.string().datetime({ offset: true }).nullish(),
  project_bindings: z.record(z.string(), z.string().uuid()).default({}),
});

export const githubAppRepositorySelectionSchema = z.enum(['all', 'selected']);

export const githubAppAccountSchema = z.object({
  id: z.number().int().nonnegative(),
  login: z.string().min(1),
  type: z.string().min(1).optional(),
  html_url: z.string().url().optional(),
});

export const githubAppSelectedRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  html_url: z.string().url().optional(),
  default_branch: z.string().nullable().optional(),
  private: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const githubAppBindingSchema = z.object({
  target_account_id: z.number().int().nonnegative().optional(),
  target_account_login: z.string().min(1).optional(),
  bound_at: z.string().datetime({ offset: true }).optional(),
  bound_via: z.enum(['manual', 'webhook_installation']).optional(),
});

export const githubAppLastDeliverySchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  action: z.string().nullable().optional(),
  received_at: z.string().datetime({ offset: true }),
});

export const githubAppConnectionMetadataSchema = z.object({
  installation_id: z.number().int().nonnegative().optional(),
  repository_selection: githubAppRepositorySelectionSchema.optional(),
  account: githubAppAccountSchema.optional(),
  selected_repository_ids: z.array(z.number().int().nonnegative()).default([]),
  selected_repositories: z.array(githubAppSelectedRepositorySchema).default([]),
  binding: githubAppBindingSchema.optional(),
  revoked_at: z.string().datetime({ offset: true }).nullable().optional(),
  suspended_at: z.string().datetime({ offset: true }).nullable().optional(),
  last_delivery: githubAppLastDeliverySchema.optional(),
});

export const connectionMetadataSchema = z
  .object({
    collections: connectorCollectionsStateSchema.optional(),
    default_project_id: z.string().uuid().optional(),
    github_app: githubAppConnectionMetadataSchema.optional(),
  })
  .catchall(z.unknown());

export const upsertConnectionSchema = z.object({
  workspace_id: z.string().uuid(),
  connector_id: z.string().min(1),
  display_name: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  status: connectionStatusSchema.default('connected'),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

export const resyncConnectionSchema = z.object({
  actor_subject_id: z.string().uuid(),
});

export const updateConnectionSchema = z.object({
  actor_subject_id: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()),
});

export const githubAppReconcileRequestSchema = z.object({
  actor_subject_id: z.string().uuid(),
  max_deliveries: z.number().int().min(1).max(50).default(25).optional(),
});

export type ConnectorCollection = z.infer<typeof connectorCollectionSchema>;
export type ConnectorCollectionsState = z.infer<typeof connectorCollectionsStateSchema>;
export type ConnectionMetadata = z.infer<typeof connectionMetadataSchema>;
export type GitHubAppAccount = z.infer<typeof githubAppAccountSchema>;
export type GitHubAppBinding = z.infer<typeof githubAppBindingSchema>;
export type GitHubAppSelectedRepository = z.infer<typeof githubAppSelectedRepositorySchema>;
export type GitHubAppConnectionMetadata = z.infer<typeof githubAppConnectionMetadataSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeConnectionMetadata(metadata: unknown): ConnectionMetadata {
  if (!isPlainObject(metadata)) return {};
  const next: Record<string, unknown> = { ...metadata };
  const parsedCollections = connectorCollectionsStateSchema.safeParse(next.collections);
  if (parsedCollections.success) {
    next.collections = parsedCollections.data;
  } else {
    delete next.collections;
  }
  const parsedDefaultProjectId = z.string().uuid().safeParse(next.default_project_id);
  if (!parsedDefaultProjectId.success) {
    delete next.default_project_id;
  }
  return next as ConnectionMetadata;
}

function rawCollectionsRecord(
  metadata: unknown,
): Record<string, unknown> | null {
  const normalizedCollections = normalizeConnectionMetadata(metadata).collections;
  if (normalizedCollections && isPlainObject(normalizedCollections)) {
    return normalizedCollections as unknown as Record<string, unknown>;
  }
  if (!isPlainObject(metadata)) return null;
  const collections = metadata.collections;
  return isPlainObject(collections) ? collections : null;
}

export function connectionCollectionItems(
  metadata: unknown,
): ConnectorCollection[] {
  const collections = rawCollectionsRecord(metadata);
  const rawItems = Array.isArray(collections?.items) ? collections.items : [];
  return rawItems.flatMap((item) => {
    const parsed = connectorCollectionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function connectionCollectionExclusionSet(
  metadata: unknown,
): Set<string> {
  const collections = rawCollectionsRecord(metadata);
  const rawExcluded = Array.isArray(collections?.excluded_ids) ? collections.excluded_ids : [];
  return new Set(
    rawExcluded.filter((collectionId): collectionId is string => typeof collectionId === 'string'),
  );
}

export function selectedConnectionCollectionIds(
  metadata: unknown,
): Set<string> | null {
  const items = connectionCollectionItems(metadata);
  if (items.length === 0) return null;
  const excluded = connectionCollectionExclusionSet(metadata);
  return new Set(items.map((item) => item.id).filter((collectionId) => !excluded.has(collectionId)));
}

export function selectedConnectionCollections(metadata: unknown): ConnectorCollection[] {
  const excluded = connectionCollectionExclusionSet(metadata);
  return connectionCollectionItems(metadata).filter((item) => !excluded.has(item.id));
}

export function githubAppConnectionMetadata(
  metadata: unknown,
): GitHubAppConnectionMetadata | null {
  const normalized = normalizeConnectionMetadata(metadata);
  return normalized.github_app ?? null;
}

export function githubAppSelectedRepositoryIds(metadata: unknown): Set<number> {
  return new Set(
    (githubAppConnectionMetadata(metadata)?.selected_repository_ids ?? []).filter((value) =>
      Number.isInteger(value),
    ),
  );
}

export function githubAppInstallationId(metadata: unknown): number | null {
  return githubAppConnectionMetadata(metadata)?.installation_id ?? null;
}

export function withDiscoveredCollections(
  metadata: unknown,
  items: ConnectorCollection[],
  discoveredAt = new Date().toISOString(),
): ConnectionMetadata {
  const normalized = normalizeConnectionMetadata(metadata);
  const current = normalized.collections;
  return {
    ...normalized,
    collections: {
      selection_mode: 'all',
      excluded_ids: current?.excluded_ids ?? [],
      items,
      discovered_at: discoveredAt,
      synced_at: current?.synced_at,
      project_bindings: current?.project_bindings ?? {},
    },
  };
}

export function withConnectionProjectBinding(
  metadata: unknown,
  input: {
    collectionId: string;
    projectId: string;
    syncedAt?: string;
  },
): ConnectionMetadata {
  const normalized = normalizeConnectionMetadata(metadata);
  const current = normalized.collections ?? {
    selection_mode: 'all' as const,
    excluded_ids: [],
    items: [],
    project_bindings: {},
  };
  return {
    ...normalized,
    collections: {
      ...current,
      synced_at: input.syncedAt ?? new Date().toISOString(),
      project_bindings: {
        ...current.project_bindings,
        [input.collectionId]: input.projectId,
      },
    },
  };
}

export type UpsertConnectionInput = z.infer<typeof upsertConnectionSchema>;
export type SetConnectionStatusInput = z.infer<typeof setConnectionStatusSchema>;
export type RevokeConnectionInput = z.infer<typeof revokeConnectionSchema>;
export type ResyncConnectionInput = z.infer<typeof resyncConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type GitHubAppReconcileRequest = z.infer<typeof githubAppReconcileRequestSchema>;

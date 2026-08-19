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

export const connectionMetadataSchema = z
  .object({
    collections: connectorCollectionsStateSchema.optional(),
    default_project_id: z.string().uuid().optional(),
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

export const updateConnectionSchema = z.object({
  actor_subject_id: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()),
});

export type ConnectorCollection = z.infer<typeof connectorCollectionSchema>;
export type ConnectorCollectionsState = z.infer<typeof connectorCollectionsStateSchema>;
export type ConnectionMetadata = z.infer<typeof connectionMetadataSchema>;

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
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

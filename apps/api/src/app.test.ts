import { describe, expect, it, vi } from 'vitest';
import { createConnectorRegistry } from '@memory-os/connector-sdk';
import { MemoryStore, type MemoryRecord } from '@memory-os/domain';
import { createApp } from './app.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const otherProjectId = '44444444-4444-4444-8444-444444444420';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const owner = '33333333-3333-4333-8333-333333333301';
const cursor = '33333333-3333-4333-8333-333333333303';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const roma = '33333333-3333-4333-8333-333333333304';

function seedAppleTransferredMemory(
  store: MemoryStore,
  input: {
    memoryId: string;
    title: string;
    source: 'companion_app' | 'share_extension' | 'document_picker' | 'photo_library';
    kind: 'text' | 'file' | 'photo' | 'video' | 'url';
    itemId: string;
    filename?: string;
    text?: string;
    sensitivity?: MemoryRecord['sensitivity'];
    status?: MemoryRecord['status'];
  },
) {
  const observedAt = '2026-08-19T23:15:00.000Z';
  const idempotencyKey = `apple-share/${input.itemId}`;
  const sourceEvent = store.ingestEvent({
    workspaceId,
    projectId,
    provider: 'apple',
    eventType: `apple.${input.kind}.captured`,
    idempotencyKey,
    observedAt,
    sensitivity: input.sensitivity ?? 'internal',
    payload: {
      schema_version: '1.0',
      title: input.title,
      filename: input.filename ?? null,
      source: {
        provider: 'apple',
        account_id: 'device:iphone-15-pro',
        external_id: input.itemId,
        external_version: observedAt,
      },
      event_type: `apple.${input.kind}.captured`,
      observed_at: observedAt,
      idempotency_key: idempotencyKey,
      scope: {
        project_id: projectId,
        sensitivity: input.sensitivity ?? 'internal',
        storage_mode: 'indexed',
      },
      provenance: {
        provider: 'apple',
        device_id: 'iphone-15-pro',
        source: input.source,
        local_identifier: `${input.itemId}-LOCAL`,
        cloud_identifier: `${input.itemId}-CLOUD`,
        provider_item_identifier:
          input.source === 'document_picker' ? `/Projects/A/${input.filename ?? input.itemId}` : null,
        canonical_reference: `apple://${input.kind}/${input.itemId}`,
        delete_local_after_ack: true,
      },
      metadata: {
        source: input.source,
        connectionId: '88888888-8888-4888-8888-888888888810',
        itemId: input.itemId,
        deleteLocalAfterAck: true,
        identifiers: {
          local_identifier: `${input.itemId}-LOCAL`,
          cloud_identifier: `${input.itemId}-CLOUD`,
          provider_item_identifier:
            input.source === 'document_picker' ? `/Projects/A/${input.filename ?? input.itemId}` : null,
        },
      },
    },
    createdBySubject: owner,
  });

  const memory: MemoryRecord = {
    id: input.memoryId,
    workspaceId,
    projectId,
    memoryType: 'fact',
    title: input.title,
    content: input.text ?? `${input.title} imported from Apple.`,
    status: input.status ?? 'candidate',
    importance: 0.55,
    confidence: 0.6,
    sensitivity: input.sensitivity ?? 'internal',
    validFrom: null,
    validTo: null,
    observedAt,
    recordedAt: '2026-08-19T23:16:00.000Z',
    supersededBy: null,
    sourceEventId: sourceEvent.id,
    createdBySubject: owner,
    schemaVersion: '1.0',
    metadata: {},
  };
  store.memories.set(memory.id, memory);
  return memory;
}

describe('memory api demo slice', () => {
  it('starts oauth stub offline', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/oauth/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        connector_id: 'github',
        display_name: 'OAuth pilot',
        scopes: ['repositories.read'],
        actor_subject_id: ownerId,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(String(body.authorizeUrl)).toContain('stub://oauth/github');
  });

  it('resolves actor via x-actor-key', async () => {
    const app = createApp({});
    const res = await app.request('/v1/me', {
      headers: { 'x-actor-key': 'cursor' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subjectId).toBe(cursor);
    expect(body.actor.externalKey).toBe('cursor');
  });

  it('lists candidate memories workspace-wide when project_id is omitted', async () => {
    const app = createApp({});
    for (const [index, targetProjectId] of [projectId, otherProjectId].entries()) {
      const captureRes = await app.request('/v1/capture/text', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': owner,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          project_id: targetProjectId,
          title: `Workspace candidate ${index + 1}`,
          text: `Candidate memory for ${targetProjectId}`,
          actor_subject_id: owner,
          idempotency_key: `workspace-candidate-${index + 1}`,
          process_now: true,
        }),
      });
      expect(captureRes.status).toBe(201);
    }

    const listRes = await app.request(
      `/v1/memories?workspace_id=${workspaceId}&status=candidate&limit=10`,
      {
        headers: { 'x-subject-id': owner },
      },
    );
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.memories).toHaveLength(2);
    expect(body.memories.map((memory: { projectId?: string | null }) => memory.projectId)).toEqual(
      expect.arrayContaining([projectId, otherProjectId]),
    );
  });

  it('lists handoffs workspace-wide when project_id is omitted', async () => {
    const app = createApp({});
    for (const [index, targetProjectId] of [projectId, otherProjectId].entries()) {
      const handoffRes = await app.request('/v1/handoffs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': owner,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          project_id: targetProjectId,
          from_subject_id: cursor,
          to_subject_id: chatgpt,
          idempotency_key: `workspace-handoff-${index + 1}`,
          payload: {
            completed: [`Done ${index + 1}`],
            artifacts: [],
            validation: [],
            open_items: [],
            blockers: [],
            recommended_next: [`Next ${index + 1}`],
          },
        }),
      });
      expect(handoffRes.status).toBe(201);
    }

    const listRes = await app.request(`/v1/handoffs?workspace_id=${workspaceId}&limit=10`, {
      headers: { 'x-subject-id': owner },
    });
    expect(listRes.status).toBe(200);
    const body = await listRes.json();
    expect(body.handoffs).toHaveLength(2);
    expect(
      body.handoffs.map((handoff: { projectId?: string | null }) => handoff.projectId),
    ).toEqual(expect.arrayContaining([projectId, otherProjectId]));
  });

  it('rejects decision writes without an explicit project id', async () => {
    const app = createApp({});
    const res = await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        title: 'Missing project',
        content: 'Should fail instead of using AISTROYKA',
        actor_subject_id: owner,
        idempotency_key: 'missing-project-decision',
        importance: 0.7,
        confidence: 0.9,
        sensitivity: 'internal',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'project_id is required for this write',
    });
  });

  it('upserts connection stub offline', async () => {
    const app = createApp({});
    const owner = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/connections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        connector_id: 'gmail',
        display_name: 'Pilot inbox',
        scopes: ['messages.metadata'],
        actor_subject_id: owner,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('lists connector catalog offline', async () => {
    const app = createApp({});
    const res = await app.request('/v1/connectors', {
      headers: { 'x-subject-id': owner },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'apple', authType: 'device' }),
        expect.objectContaining({ id: 'github', authType: 'oauth2' }),
        expect.objectContaining({ id: 'gmail' }),
        expect.objectContaining({ id: 'google-drive' }),
        expect.objectContaining({ id: 'google-calendar' }),
      ]),
    );
  });

  it('reports connector health offline', async () => {
    const app = createApp({});
    const res = await app.request('/v1/connections/88888888-8888-4888-8888-888888888801/health', {
      headers: { 'x-subject-id': owner },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connectionId).toBe('88888888-8888-4888-8888-888888888801');
    expect(body.status).toBe('healthy');
  });

  it('discovers GitHub repositories offline', async () => {
    const app = createApp({});
    const res = await app.request('/v1/connections/88888888-8888-4888-8888-888888888801/discover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: owner,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections).toHaveLength(2);
    expect(body.collections[0].id).toBe('aistroyka/core');
  });

  it('replaces discovered collections so vanished repos are removed', async () => {
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'github',
          version: '1.0.0',
          sdk_version: '^1.0',
          default_stream: 'github:user-events',
          auth: 'oauth2',
          capabilities: ['repositories.read'],
          supports: {
            discover: true,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: true,
            write: false,
          },
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async discover() {
            return {
              collections: [
                {
                  id: 'team/repo-a',
                  kind: 'repository' as const,
                  name: 'repo-a',
                  title: 'team/repo-a',
                  url: 'https://github.com/team/repo-a',
                  default_branch: 'main',
                  metadata: {},
                },
              ],
            };
          },
          async normalize() {
            throw new Error('not used in discover test');
          },
        },
      },
    ]);

    let metadataState: Record<string, unknown> = {
      collections: {
        selection_mode: 'all',
        excluded_ids: ['team/repo-b'],
        items: [
          {
            id: 'team/repo-a',
            kind: 'repository',
            name: 'repo-a',
            title: 'team/repo-a',
            url: 'https://github.com/team/repo-a',
            default_branch: 'main',
            metadata: {},
          },
          {
            id: 'team/repo-b',
            kind: 'repository',
            name: 'repo-b',
            title: 'team/repo-b',
            url: 'https://github.com/team/repo-b',
            default_branch: 'main',
            metadata: {},
          },
        ],
        project_bindings: {
          'team/repo-a': '44444444-4444-4444-8444-444444444420',
          'team/repo-b': '44444444-4444-4444-8444-444444444421',
        },
      },
    };
    const refreshConnectionCollections = vi.fn(async ({
      items,
      projectBindings,
    }: {
      items: unknown[];
      projectBindings?: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items,
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...(projectBindings ?? {}),
          },
        },
      };
      return {
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      };
    });
    const mergeConnectionProjectBindings = vi.fn(async ({
      projectBindings,
    }: {
      projectBindings: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items: currentCollections.items ?? [],
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...(projectBindings ?? {}),
          },
        },
      };
      return {
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      };
    });
    const gateway = {
      getConnection: vi.fn(async () => ({
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      })),
      refreshConnectionCollections,
      mergeConnectionProjectBindings,
      upsertProjectFromConnector: vi.fn(async ({ collectionId }: { collectionId: string }) => ({
        projectId:
          collectionId === 'team/repo-a'
            ? '44444444-4444-4444-8444-444444444420'
            : '44444444-4444-4444-8444-444444444421',
        slug: collectionId.replace('/', '-'),
        name: collectionId,
        memoryId: `memory-${collectionId}`,
        collectionId,
      })),
    };

    const app = createApp({
      gateway: gateway as any,
      connectorRegistry,
    });
    const res = await app.request('/v1/connections/conn-1/discover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections.map((collection: { id: string }) => collection.id)).toEqual([
      'team/repo-a',
    ]);
    expect(
      ((metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).map(
        (collection) => collection.id,
      ),
    ).toEqual(['team/repo-a']);
    expect(
      ((metadataState.collections as Record<string, unknown>).excluded_ids as string[]),
    ).toContain('team/repo-b');
  });

  it('keeps a webhook-added repo when discover later writes project bindings', async () => {
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'github',
          version: '1.0.0',
          sdk_version: '^1.0',
          default_stream: 'github:user-events',
          auth: 'oauth2',
          capabilities: ['repositories.read'],
          supports: {
            discover: true,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: true,
            write: false,
          },
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async discover() {
            return {
              collections: [
                {
                  id: 'team/repo-a',
                  kind: 'repository' as const,
                  name: 'repo-a',
                  title: 'team/repo-a',
                  url: 'https://github.com/team/repo-a',
                  default_branch: 'main',
                  metadata: {},
                },
              ],
            };
          },
          async normalize() {
            throw new Error('not used in discover test');
          },
        },
      },
    ]);

    let metadataState: Record<string, unknown> = {
      collections: {
        selection_mode: 'all',
        excluded_ids: [],
        items: [
          {
            id: 'team/repo-a',
            kind: 'repository',
            name: 'repo-a',
            title: 'team/repo-a',
            url: 'https://github.com/team/repo-a',
            default_branch: 'main',
            metadata: {},
          },
        ],
        project_bindings: {
          'team/repo-a': '44444444-4444-4444-8444-444444444420',
        },
      },
    };
    const buildConnection = () => ({
      id: 'conn-1',
      workspaceId: workspaceId,
      connectorId: 'github',
      displayName: 'Fixture GitHub',
      status: 'connected',
      scopes: ['repositories.read'],
      lastSyncAt: null,
      lastError: null,
      metadata: metadataState,
    });
    const refreshConnectionCollections = vi.fn(async ({
      items,
      projectBindings,
    }: {
      items: unknown[];
      projectBindings?: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items,
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...(projectBindings ?? {}),
          },
        },
      };
      return buildConnection();
    });
    const upsertConnectionCollectionItem = vi.fn(async ({
      item,
    }: {
      item: { id?: string };
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      const currentItems = Array.isArray(currentCollections.items)
        ? (currentCollections.items as Array<Record<string, unknown>>)
        : [];
      const nextItems =
        typeof item.id === 'string'
          ? [
              ...currentItems.filter((existing) => existing.id !== item.id),
              item as Record<string, unknown>,
            ]
          : currentItems;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items: nextItems,
          project_bindings: currentCollections.project_bindings ?? {},
        },
      };
      return buildConnection();
    });
    const mergeConnectionProjectBindings = vi.fn(async ({
      projectBindings,
    }: {
      projectBindings: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items: currentCollections.items ?? [],
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...projectBindings,
          },
        },
      };
      return buildConnection();
    });
    let gateway: any;
    let webhookInjected = false;
    gateway = {
      getConnection: vi.fn(async () => buildConnection()),
      refreshConnectionCollections,
      upsertConnectionCollectionItem,
      mergeConnectionProjectBindings,
      upsertProjectFromConnector: vi.fn(async ({ collectionId }: { collectionId: string }) => {
        if (!webhookInjected) {
          webhookInjected = true;
          await upsertConnectionCollectionItem({
            item: {
              id: 'team/repo-b',
              kind: 'repository',
              name: 'repo-b',
              title: 'team/repo-b',
              url: 'https://github.com/team/repo-b',
              default_branch: 'main',
              metadata: {},
            },
          });
        }
        return {
          projectId:
            collectionId === 'team/repo-a'
              ? '44444444-4444-4444-8444-444444444420'
              : '44444444-4444-4444-8444-444444444421',
          slug: collectionId.replace('/', '-'),
          name: collectionId,
          memoryId: `memory-${collectionId}`,
          collectionId,
        };
      }),
    };

    const app = createApp({
      gateway: gateway as any,
      connectorRegistry,
    });
    const res = await app.request('/v1/connections/conn-1/discover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(200);
    expect(refreshConnectionCollections).toHaveBeenCalledOnce();
    expect(upsertConnectionCollectionItem).toHaveBeenCalledTimes(1);
    expect(mergeConnectionProjectBindings).toHaveBeenCalledOnce();
    expect(
      ((metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).map(
        (collection) => collection.id,
      ),
    ).toEqual(expect.arrayContaining(['team/repo-a', 'team/repo-b']));
    expect(gateway.upsertProjectFromConnector).toHaveBeenCalledTimes(1);
    expect(
      gateway.upsertProjectFromConnector.mock.calls.map(
        ([input]: [{ collectionId: string }]) => input.collectionId,
      ),
    ).toEqual(['team/repo-a']);
  });

  it('retains a webhook-added repo across discover under the SQL lock and drops it on a later missing discover', async () => {
    let metadataState: Record<string, unknown> = {
      collections: {
        selection_mode: 'all',
        excluded_ids: [],
        discovered_at: '2026-08-19T18:00:00.000Z',
        items: [
          {
            id: 'team/repo-a',
            kind: 'repository',
            name: 'repo-a',
            title: 'team/repo-a',
            url: 'https://github.com/team/repo-a',
            default_branch: 'main',
            metadata: {},
          },
        ],
        project_bindings: {
          'team/repo-a': '44444444-4444-4444-8444-444444444420',
        },
      },
    };
    const buildConnection = () => ({
      id: 'conn-1',
      workspaceId: workspaceId,
      connectorId: 'github',
      displayName: 'Fixture GitHub',
      status: 'connected',
      scopes: ['repositories.read'],
      lastSyncAt: null,
      lastError: null,
      metadata: metadataState,
    });
    const repoA = {
      id: 'team/repo-a',
      kind: 'repository' as const,
      name: 'repo-a',
      title: 'team/repo-a',
      url: 'https://github.com/team/repo-a',
      default_branch: 'main',
      metadata: {},
    };
    const repoB = {
      id: 'team/repo-b',
      kind: 'repository' as const,
      name: 'repo-b',
      title: 'team/repo-b',
      url: 'https://github.com/team/repo-b',
      default_branch: 'main',
      metadata: {
        added_via: 'webhook',
        added_at: '2026-08-19T18:05:00.000Z',
      },
    };
    let gateway: any;
    let discoverCount = 0;
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'github',
          version: '1.0.0',
          sdk_version: '^1.0',
          default_stream: 'github:user-events',
          auth: 'oauth2',
          capabilities: ['repositories.read'],
          supports: {
            discover: true,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: true,
            write: false,
          },
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async discover() {
            discoverCount += 1;
            if (discoverCount === 1) {
              await gateway.upsertConnectionCollectionItem({ item: repoB });
            }
            return {
              collections: [repoA],
            };
          },
          async normalize() {
            throw new Error('not used in discover test');
          },
        },
      },
    ]);
    const refreshConnectionCollections = vi.fn(async ({
      items,
      projectBindings,
      discoveredAt,
    }: {
      items: unknown[];
      projectBindings?: Record<string, string>;
      discoveredAt?: string;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      const currentItems = Array.isArray(currentCollections.items)
        ? (currentCollections.items as Array<{
            id?: string;
            metadata?: Record<string, unknown>;
          }>)
        : [];
      const providerItems = items as Array<{
        id?: string;
      }>;
      const providerIds = new Set(
        providerItems
          .map((item) => item.id)
          .filter((itemId): itemId is string => typeof itemId === 'string'),
      );
      const previousDiscoveredAt =
        typeof currentCollections.discovered_at === 'string'
          ? Date.parse(currentCollections.discovered_at)
          : Number.NaN;
      const retainedWebhookItems = currentItems.filter((item) => {
        if (typeof item.id !== 'string' || providerIds.has(item.id)) return false;
        if (item.metadata?.added_via !== 'webhook') return false;
        const addedAt =
          typeof item.metadata?.added_at === 'string'
            ? Date.parse(item.metadata.added_at)
            : Number.NaN;
        if (!Number.isFinite(addedAt)) return false;
        return !Number.isFinite(previousDiscoveredAt) || addedAt > previousDiscoveredAt;
      });
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          discovered_at: discoveredAt ?? new Date().toISOString(),
          items: [...providerItems, ...retainedWebhookItems],
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...(projectBindings ?? {}),
          },
        },
      };
      return buildConnection();
    });
    const mergeConnectionProjectBindings = vi.fn(async ({
      projectBindings,
    }: {
      projectBindings: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          discovered_at: currentCollections.discovered_at,
          items: currentCollections.items ?? [],
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...projectBindings,
          },
        },
      };
      return buildConnection();
    });
    gateway = {
      getConnection: vi.fn(async () => buildConnection()),
      refreshConnectionCollections,
      mergeConnectionProjectBindings,
      upsertConnectionCollectionItem: vi.fn(async ({ item }: { item: Record<string, unknown> }) => {
        const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
        expect(currentCollections.discovered_at).toBe('2026-08-19T18:00:00.000Z');
        const currentItems = Array.isArray(currentCollections.items)
          ? (currentCollections.items as Array<Record<string, unknown>>)
          : [];
        metadataState = {
          ...metadataState,
          collections: {
            selection_mode: 'all',
            excluded_ids: currentCollections.excluded_ids ?? [],
            discovered_at: currentCollections.discovered_at,
            items: [
              ...currentItems.filter((existing) => existing.id !== item.id),
              item,
            ],
            project_bindings: currentCollections.project_bindings ?? {},
          },
        };
        return buildConnection();
      }),
      upsertProjectFromConnector: vi.fn(async ({ collectionId }: { collectionId: string }) => ({
        projectId:
          collectionId === 'team/repo-a'
            ? '44444444-4444-4444-8444-444444444420'
            : '44444444-4444-4444-8444-444444444421',
        slug: collectionId.replace('/', '-'),
        name: collectionId,
        memoryId: `memory-${collectionId}`,
        collectionId,
      })),
    };

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-19T18:10:00.000Z'));
      const app = createApp({
        gateway: gateway as any,
        connectorRegistry,
      });

      const first = await app.request('/v1/connections/conn-1/discover', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': owner,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: owner,
        }),
      });
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.collections.map((collection: { id: string }) => collection.id)).toEqual(
        expect.arrayContaining(['team/repo-a', 'team/repo-b']),
      );
      expect(
        (metadataState.collections as Record<string, unknown>).discovered_at,
      ).toBe('2026-08-19T18:10:00.000Z');
      expect(refreshConnectionCollections).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [repoA],
        }),
      );

      vi.setSystemTime(new Date('2026-08-19T18:20:00.000Z'));
      const second = await app.request('/v1/connections/conn-1/discover', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': owner,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: owner,
        }),
      });
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.collections.map((collection: { id: string }) => collection.id)).toEqual([
        'team/repo-a',
      ]);
      expect(
        ((metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).map(
          (collection) => collection.id,
        ),
      ).toEqual(['team/repo-a']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves unchecked collections across API sync', async () => {
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'github',
          version: '1.0.0',
          sdk_version: '^1.0',
          default_stream: 'github:user-events',
          auth: 'oauth2',
          capabilities: ['repositories.read'],
          supports: {
            discover: true,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: false,
            write: false,
          },
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async discover() {
            return {
              collections: [
                {
                  id: 'team/repo-a',
                  kind: 'repository' as const,
                  name: 'repo-a',
                  title: 'team/repo-a',
                  url: 'https://github.com/team/repo-a',
                  default_branch: 'main',
                  metadata: {},
                },
                {
                  id: 'team/repo-b',
                  kind: 'repository' as const,
                  name: 'repo-b',
                  title: 'team/repo-b',
                  url: 'https://github.com/team/repo-b',
                  default_branch: 'main',
                  metadata: {},
                },
              ],
            };
          },
          async initialSync() {
            return {
              stream: 'github:user-events',
              mode: 'initial' as const,
              rawObjects: [{ id: 'evt-1', repo: 'team/repo-a' }],
              pullMode: 'stub',
              note: 'fixture sync',
            };
          },
          async normalize(context) {
            return {
              externalObject: {
                provider: 'github',
                accountId: context.account.connectionId,
                collectionId: context.rawObject.repo,
                externalId: context.rawObject.id,
                objectType: 'fixture',
                title: context.rawObject.repo,
                createdAt: '2026-08-19T16:00:00.000Z',
                modifiedAt: '2026-08-19T16:00:00.000Z',
                deleted: false,
                attachments: [],
                permissionsSnapshot: {},
                metadata: {},
              },
              envelope: {
                schema_version: '1.0',
                workspace_id: workspaceId,
                source: {
                  provider: 'github',
                  account_id: context.account.connectionId,
                  external_id: context.rawObject.id,
                },
                event_type: 'github.fixture',
                observed_at: '2026-08-19T16:00:00.000Z',
                idempotency_key: `fixture/${context.rawObject.id}`,
                scope: {
                  sensitivity: 'internal',
                  storage_mode: 'reference',
                },
                provenance: {},
              },
              capture: {
                title: 'Fixture event',
                text: 'Fixture text',
                filename: 'fixture://evt-1',
                mimeType: 'text/plain',
                idempotencyKey: `fixture/${context.rawObject.id}`,
              },
            };
          },
        },
      },
    ]);

    let metadataState: Record<string, unknown> = {
      collections: {
        selection_mode: 'all',
        excluded_ids: ['team/repo-b'],
        items: [
          {
            id: 'team/repo-a',
            kind: 'repository',
            name: 'repo-a',
            title: 'team/repo-a',
            url: 'https://github.com/team/repo-a',
            default_branch: 'main',
            metadata: {},
          },
          {
            id: 'team/repo-b',
            kind: 'repository',
            name: 'repo-b',
            title: 'team/repo-b',
            url: 'https://github.com/team/repo-b',
            default_branch: 'main',
            metadata: {},
          },
        ],
        project_bindings: {},
      },
    };
    const refreshConnectionCollections = vi.fn(async ({
      items,
      projectBindings,
    }: {
      items: unknown[];
      projectBindings?: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items,
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...(projectBindings ?? {}),
          },
        },
      };
      return {
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      };
    });
    const mergeConnectionProjectBindings = vi.fn(async ({
      projectBindings,
    }: {
      projectBindings: Record<string, string>;
    }) => {
      const currentCollections = (metadataState.collections ?? {}) as Record<string, unknown>;
      metadataState = {
        ...metadataState,
        collections: {
          selection_mode: 'all',
          excluded_ids: currentCollections.excluded_ids ?? [],
          items: currentCollections.items ?? [],
          project_bindings: {
            ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
            ...projectBindings,
          },
        },
      };
      return {
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      };
    });
    const projectIds: Record<string, string> = {
      'team/repo-a': '44444444-4444-4444-8444-444444444420',
      'team/repo-b': '44444444-4444-4444-8444-444444444421',
    };
    const upsertProjectFromConnector = vi.fn(async ({ collectionId }: { collectionId: string }) => ({
      projectId: projectIds[collectionId] ?? '44444444-4444-4444-8444-444444444499',
      slug: collectionId.replace('/', '-'),
      name: collectionId,
      memoryId: `memory-${collectionId}`,
      collectionId,
    }));
    const gateway = {
      enqueueConnectorSync: vi.fn(async () => ({
        count: 1,
        enqueued: [
          {
            connectionId: 'conn-1',
            connectorId: 'github',
            displayName: 'Fixture GitHub',
            vaultRef: null,
            jobId: 'job-1',
          },
        ],
      })),
      getConnection: vi.fn(async () => ({
        id: 'conn-1',
        workspaceId: workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'connected',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: null,
        metadata: metadataState,
      })),
      refreshConnectionCollections,
      mergeConnectionProjectBindings,
      upsertProjectFromConnector,
      getConnectorCursor: vi.fn(async () => null),
      captureConnectorRecord: vi.fn(async () => ({ process: null })),
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async () => ({
        jobId: 'job-1',
        status: 'succeeded',
        connectionId: 'conn-1',
      })),
      appendAuditEvent: vi.fn(async () => ({})),
    };

    const app = createApp({
      gateway: gateway as any,
      connectorRegistry,
    });
    const res = await app.request('/v1/connections/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(202);
    expect(refreshConnectionCollections).toHaveBeenCalled();
    expect(metadataState.collections.excluded_ids).toContain('team/repo-b');
    expect(upsertProjectFromConnector.mock.calls.map(([input]) => input.collectionId)).toEqual([
      'team/repo-a',
    ]);
  });

  it('skips connector record capture when no explicit project binding exists', async () => {
    const driveConnectionId = '88888888-8888-4888-8888-888888888804';
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'google-drive',
          version: '1.0.0',
          sdk_version: '^1.0',
          auth: 'oauth2',
          supports: {
            discover: false,
            validate_scope: false,
            initial_sync: true,
            incremental_sync: false,
            live_fetch: false,
            webhooks: false,
            write: false,
          },
          capabilities: ['files.read', 'changes.list'],
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async initialSync() {
            return {
              stream: 'google-drive:files',
              mode: 'initial' as const,
              pullMode: 'stub',
              note: 'fixture drive sync',
              rawObjects: [
                {
                  externalId: 'file/drive-1',
                  title: 'Unbound drive record',
                  observedAt: '2026-08-20T00:20:00.000Z',
                },
              ],
            };
          },
          async normalize(context) {
            return {
              externalObject: {
                provider: 'google-drive',
                accountId: context.account.connectionId,
                externalId: 'file/drive-1',
                objectType: 'file',
                title: 'Unbound drive record',
                createdAt: '2026-08-20T00:20:00.000Z',
                modifiedAt: '2026-08-20T00:20:00.000Z',
                deleted: false,
                attachments: [],
                permissionsSnapshot: {},
                metadata: {},
              },
              envelope: {
                schema_version: '1.0' as const,
                workspace_id: workspaceId,
                source: {
                  provider: 'google-drive',
                  account_id: driveConnectionId,
                  external_id: 'file/drive-1',
                },
                event_type: 'google-drive.file.updated',
                observed_at: '2026-08-20T00:20:00.000Z',
                idempotency_key: 'connector-sync/conn-drive/file/drive-1',
                content: {
                  mime_type: 'text/plain',
                  text: 'Unbound drive record',
                },
                scope: {
                  sensitivity: 'internal' as const,
                  storage_mode: 'reference' as const,
                },
                provenance: {
                  sourceMode: 'stub',
                },
              },
              capture: {
                title: 'Unbound drive record',
                text: 'Unbound drive record',
                filename: 'google-drive://file/drive-1',
                mimeType: 'text/plain',
                idempotencyKey: 'connector-sync/conn-drive/file/drive-1',
              },
            };
          },
        },
      },
    ]);
    const captureConnectorRecord = vi.fn(async () => ({ process: null }));
    const gateway = {
      enqueueConnectorSync: vi.fn(async () => ({
        count: 1,
        enqueued: [
          {
            connectionId: driveConnectionId,
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            jobId: 'job-drive-1',
          },
        ],
      })),
      getConnection: vi.fn(async () => ({
        id: driveConnectionId,
        workspaceId,
        connectorId: 'google-drive',
        displayName: 'Drive pilot',
        status: 'connected',
        scopes: ['drive.file'],
        lastSyncAt: null,
        lastError: null,
        metadata: {
          collections: {
            selection_mode: 'selected',
            excluded_ids: [],
            items: [
              {
                id: 'google-drive:folder:FOLDER-1',
                external_id: 'FOLDER-1',
                kind: 'folder',
                name: 'Specs',
                title: 'Specs',
                metadata: {},
              },
            ],
            project_bindings: {},
          },
        },
      })),
      refreshConnectionCollections: vi.fn(async () => ({ metadata: {} })),
      mergeConnectionProjectBindings: vi.fn(async () => ({ metadata: {} })),
      upsertProjectFromConnector: vi.fn(async () => ({
        projectId: '44444444-4444-4444-8444-444444444421',
        slug: 'fixture-drive',
        name: 'Fixture Drive',
        memoryId: '66666666-6666-4666-8666-666666666602',
        collectionId: 'google-drive:folder:FOLDER-1',
      })),
      getConnectorCursor: vi.fn(async () => null),
      captureConnectorRecord,
      tombstoneConnectorObject: vi.fn(async () => ({ affectedCount: 0 })),
      upsertConnectorCursor: vi.fn(async () => null),
      completeConnectorSync: vi.fn(async () => ({
        jobId: 'job-drive-1',
        status: 'succeeded',
        connectionId: driveConnectionId,
      })),
      appendAuditEvent: vi.fn(async () => ({})),
    };

    const app = createApp({
      gateway: gateway as any,
      connectorRegistry,
    });
    const res = await app.request('/v1/connections/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        connection_id: driveConnectionId,
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(202);
    expect(captureConnectorRecord).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.captured).toBe(0);
  });

  it('patches connection metadata offline', async () => {
    const app = createApp({});
    const res = await app.request('/v1/connections/88888888-8888-4888-8888-888888888801', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        actor_subject_id: owner,
        metadata: {
          collections: {
            selection_mode: 'all',
            excluded_ids: ['aistroyka/core'],
            items: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metadata.collections.excluded_ids).toContain('aistroyka/core');
  });

  it('revokes a connection offline via revoke alias', async () => {
    const app = createApp({});
    const res = await app.request('/v1/connections/88888888-8888-4888-8888-888888888801/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        actor_subject_id: owner,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('revoked');
    expect(body.revoked).toBe(true);
  });

  it('calls connector lifecycle revoke before marking the connection revoked', async () => {
    const revokeSpy = vi.fn(async () => undefined);
    const gateway = {
      getConnection: vi.fn(async () => ({
        id: 'conn-revoke',
        workspaceId,
        connectorId: 'sample-revoke',
        displayName: 'Sample revoke connector',
        status: 'connected',
        scopes: ['fixtures.read'],
        lastSyncAt: null,
        lastError: null,
        vaultRef: 'vault:test/revoke',
        metadata: {},
      })),
      setConnectionStatus: vi.fn(async ({ connectionId, status }: { connectionId: string; status: string }) => ({
        id: connectionId,
        connectorId: 'sample-revoke',
        status,
      })),
      vaultDelete: vi.fn(async () => ({ ok: true })),
    };
    const connectorRegistry = createConnectorRegistry([
      {
        manifest: {
          id: 'sample-revoke',
          version: '1.0.0',
          sdk_version: '^1.0',
          auth: 'none',
          supports: {
            discover: false,
            validate_scope: false,
            initial_sync: false,
            incremental_sync: false,
            live_fetch: false,
            webhooks: false,
            write: false,
          },
          capabilities: ['fixtures.read'],
          storage_modes: ['reference'],
          data_classes: ['internal'],
        },
        lifecycle: {
          async normalize() {
            throw new Error('normalize is not used in revoke test');
          },
          revoke: revokeSpy,
        },
      },
    ]);

    const app = createApp({
      gateway: gateway as any,
      connectorRegistry,
    });
    const res = await app.request('/v1/connections/conn-revoke/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(200);
    expect(revokeSpy).toHaveBeenCalledOnce();
    expect(gateway.setConnectionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-revoke',
        status: 'revoked',
      }),
    );
  });

  it('requests a connector resync through the gateway and returns the queued job', async () => {
    const gateway = {
      getConnection: vi.fn(async () => ({
        id: 'conn-resync',
        workspaceId,
        connectorId: 'github',
        displayName: 'Fixture GitHub',
        status: 'degraded',
        scopes: ['repositories.read'],
        lastSyncAt: null,
        lastError: 'cursor expired',
        metadata: {},
      })),
      resyncConnector: vi.fn(async () => ({
        jobId: 'job-resync',
        eventId: 'event-resync',
        connectionId: 'conn-resync',
        connectorId: 'github',
        clearedCursorCount: 1,
        idempotencyKey: 'connector-sync/conn-resync/resync/1',
      })),
    };

    const app = createApp({ gateway: gateway as any });
    const res = await app.request('/v1/connections/conn-resync/resync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.resync).toBe(true);
    expect(body.jobId).toBe('job-resync');
    expect(gateway.resyncConnector).toHaveBeenCalledWith({
      subjectId: owner,
      workspaceId,
      connectionId: 'conn-resync',
    });
  });

  it('replays a dead-letter connector job through the gateway', async () => {
    const gateway = {
      replayConnectorSync: vi.fn(async () => ({
        jobId: 'job-dead-letter',
        status: 'queued',
        attempt: 3,
        connectionId: 'conn-replay',
        jobType: 'connector_sync',
        resync: false,
        clearedCursorCount: 0,
      })),
    };

    const app = createApp({ gateway: gateway as any });
    const res = await app.request('/v1/jobs/job-dead-letter/replay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        actor_subject_id: owner,
      }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.replayed).toBe(true);
    expect(body.status).toBe('queued');
    expect(gateway.replayConnectorSync).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: owner,
        jobId: 'job-dead-letter',
      }),
    );
  });

  it('serves project context to cursor', async () => {
    const app = createApp({});
    const res = await app.request(`/v1/projects/${projectId}/context`, {
      headers: { 'x-subject-id': cursor },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions.length).toBeGreaterThan(0);
  });

  it('keeps personal Gmail and Calendar memories out of agent search/context while owner still sees them', async () => {
    const app = createApp({});
    for (const memory of [
      {
        title: 'Personal Gmail API memory',
        text: 'Personal Gmail API memory about family travel must stay private.',
        idempotency_key: `api-personal-gmail-${Date.now()}`,
      },
      {
        title: 'Personal Calendar API memory',
        text: 'Personal Calendar API memory about a doctor appointment must stay private.',
        idempotency_key: `api-personal-calendar-${Date.now()}`,
      },
    ]) {
      const created = await app.request('/v1/capture/text', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': owner,
          'x-actor-key': 'owner',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          project_id: projectId,
          title: memory.title,
          text: memory.text,
          actor_subject_id: owner,
          idempotency_key: memory.idempotency_key,
          sensitivity: 'personal',
        }),
      });
      expect(created.status).toBe(201);
    }

    const ownerSearch = await app.request('/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        query: 'personal api memory',
        project_id: projectId,
      }),
    });
    expect(ownerSearch.status).toBe(200);
    const ownerSearchBody = await ownerSearch.json();
    expect(
      ownerSearchBody.hits.some(
        (hit: { memory: { title: string } }) => hit.memory.title === 'Personal Gmail API memory',
      ),
    ).toBe(true);
    expect(
      ownerSearchBody.hits.some(
        (hit: { memory: { title: string } }) =>
          hit.memory.title === 'Personal Calendar API memory',
      ),
    ).toBe(true);

    const ownerContext = await app.request(`/v1/projects/${projectId}/context`, {
      headers: {
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
    });
    expect(ownerContext.status).toBe(200);
    const ownerContextBody = await ownerContext.json();
    expect(
      ownerContextBody.facts.some(
        (memory: { title: string }) => memory.title === 'Personal Gmail API memory',
      ),
    ).toBe(true);
    expect(
      ownerContextBody.facts.some(
        (memory: { title: string }) => memory.title === 'Personal Calendar API memory',
      ),
    ).toBe(true);

    for (const actor of [
      { subjectId: chatgpt, actorKey: 'chatgpt' },
      { subjectId: cursor, actorKey: 'cursor' },
      { subjectId: roma, actorKey: 'roma' },
    ] as const) {
      const deniedSearch = await app.request('/v1/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': actor.subjectId,
          'x-actor-key': actor.actorKey,
        },
        body: JSON.stringify({
          query: 'personal api memory',
          project_id: projectId,
        }),
      });
      expect(deniedSearch.status).toBe(200);
      const deniedSearchBody = await deniedSearch.json();
      expect(deniedSearchBody.hits).toEqual([]);

      const deniedContext = await app.request(`/v1/projects/${projectId}/context`, {
        headers: {
          'x-subject-id': actor.subjectId,
          'x-actor-key': actor.actorKey,
        },
      });
      expect(deniedContext.status).toBe(200);
      const deniedContextBody = await deniedContext.json();
      expect(
        deniedContextBody.facts.some(
          (memory: { title: string }) => memory.title === 'Personal Gmail API memory',
        ),
      ).toBe(false);
      expect(
        deniedContextBody.facts.some(
          (memory: { title: string }) => memory.title === 'Personal Calendar API memory',
        ),
      ).toBe(false);
    }
  });

  it('lists projects offline', async () => {
    const app = createApp({});
    const res = await app.request(`/v1/projects?workspace_id=${workspaceId}`, {
      headers: { 'x-subject-id': owner },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([
      expect.objectContaining({
        id: projectId,
        slug: 'aistroyka',
        name: 'AISTROYKA',
      }),
    ]);
  });

  it('creates handoff from cursor', async () => {
    const app = createApp({});
    const res = await app.request('/v1/handoffs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': cursor,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        from_subject_id: cursor,
        to_subject_id: chatgpt,
        idempotency_key: 'handoff-1',
        payload: {
          completed: ['read project context'],
          artifacts: [{ type: 'commit', ref: 'abc123' }],
          validation: ['typecheck'],
          open_items: ['WP-02 apply to remote supabase'],
          blockers: [],
          recommended_next: ['continue MCP wiring'],
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('creates handoff from roma', async () => {
    const app = createApp({});
    const res = await app.request('/v1/handoffs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': roma,
        'x-actor-key': 'roma',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        from_subject_id: roma,
        to_subject_id: cursor,
        idempotency_key: 'handoff-roma-1',
        payload: {
          completed: ['ran QA checks'],
          artifacts: [{ type: 'report', ref: 'qa/report-1' }],
          validation: ['handoff api'],
          open_items: ['owner review'],
          blockers: [],
          recommended_next: ['continue remediation'],
        },
      }),
    });
    expect(res.status).toBe(201);
  });

  it('lists persisted handoff history offline', async () => {
    const app = createApp({});
    await app.request('/v1/handoffs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': cursor,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        from_subject_id: cursor,
        to_subject_id: chatgpt,
        idempotency_key: 'handoff-history-1',
        payload: {
          completed: ['queued implementation'],
          artifacts: [],
          validation: ['unit tests'],
          open_items: ['finish audit page'],
          blockers: [],
          recommended_next: ['wire privacy page'],
        },
      }),
    });
    const listed = await app.request(
      `/v1/handoffs?workspace_id=${workspaceId}&project_id=${projectId}&limit=10`,
      {
        headers: { 'x-subject-id': cursor },
      },
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(Array.isArray(body.handoffs)).toBe(true);
    expect(body.handoffs.length).toBeGreaterThan(0);
    expect(body.handoffs[0].payload.recommended_next).toContain('wire privacy page');
  });

  it('captures a plain-text document into candidate memory', async () => {
    const app = createApp({});
    const content = Buffer.from(
      'Document capture alpha for Memory OS.',
      'utf8',
    ).toString('base64');
    const res = await app.request('/v1/capture/document', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Doc capture',
        filename: 'note.txt',
        mime_type: 'text/plain',
        content_base64: content,
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/doc-1',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memoryId).toBeTruthy();
    expect(body.extractedChars).toBeGreaterThan(10);
  });

  it('rejects oversized document capture', async () => {
    const app = createApp({});
    const content = Buffer.alloc(5 * 1024 * 1024 + 8, 97).toString('base64');
    const res = await app.request('/v1/capture/document', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Poison huge',
        filename: 'huge.txt',
        mime_type: 'text/plain',
        content_base64: content,
        actor_subject_id: chatgpt,
        idempotency_key: `poison/huge-${Date.now()}`,
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects private link capture targets', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        url: 'http://127.0.0.1/secret',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/link-blocked-1',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('captures text into candidate memory', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Capture alpha',
        text: 'Text capture creates a reviewable candidate memory.',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/capture-1',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memoryId).toBeTruthy();
  });

  it('rejects workspace-level capture from chatgpt without an explicit project', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        title: 'Workspace only',
        text: 'This should not widen access.',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/workspace-capture-1',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'project_id is required for this write',
    });
  });

  it('still rejects chatgpt capture into an ungranted concrete project', async () => {
    const app = createApp({});
    const res = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: '00000000-0000-4000-8000-000000000099',
        title: 'Wrong project',
        text: 'This should stay forbidden.',
        actor_subject_id: chatgpt,
        idempotency_key: 'manual/workspace-capture-2',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('requires api secret on consolidation when auth enforced', async () => {
    const prevRequire = process.env.MEMORY_OS_REQUIRE_API_AUTH;
    const prevSecret = process.env.MEMORY_OS_API_SECRET;
    process.env.MEMORY_OS_REQUIRE_API_AUTH = '1';
    process.env.MEMORY_OS_API_SECRET = 'test-http-secret';
    try {
      const app = createApp({});
      const ownerId = '33333333-3333-4333-8333-333333333301';
      const denied = await app.request('/v1/consolidation/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          apply: false,
        }),
      });
      expect(denied.status).toBe(401);
      const allowed = await app.request('/v1/consolidation/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
          'x-memory-os-api-secret': 'test-http-secret',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          apply: false,
        }),
      });
      expect(allowed.status).toBe(200);
    } finally {
      if (prevRequire === undefined) delete process.env.MEMORY_OS_REQUIRE_API_AUTH;
      else process.env.MEMORY_OS_REQUIRE_API_AUTH = prevRequire;
      if (prevSecret === undefined) delete process.env.MEMORY_OS_API_SECRET;
      else process.env.MEMORY_OS_API_SECRET = prevSecret;
    }
  });

  it('serves health with embed/vault modes', async () => {
    const app = createApp({});
    const mcpHealth = await app.request('/mcp/health');
    expect(mcpHealth.status).toBe(200);
    const mcpHealthBody = await mcpHealth.json();
    expect(mcpHealthBody.transport).toBe('streamable-http');
    expect(mcpHealthBody.profile).toBeTruthy();
    const mcpGet = await app.request('/mcp');
    expect(mcpGet.status).toBe(405);
    const mcpInit = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      }),
    });
    expect(mcpInit.status).toBe(200);
    const mcpBody = await mcpInit.json();
    expect(mcpBody.result.serverInfo.name).toBe('memory-os-mcp-gateway');
    expect(mcpBody.result.protocolVersion).toBe('2025-03-26');
    expect(String(mcpBody.result.instructions ?? '')).toMatch(/Memory OS/i);

    const res = await app.request('/health', {
      headers: { 'x-request-id': 'test-req-health-1' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('test-req-health-1');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.embedEngine).toBeTruthy();
    expect(body.vaultBackend).toBeTruthy();
    expect(body.mcp).toBe('/mcp');
    expect(body.requestId).toBe('test-req-health-1');
  });

  it('exposes ChatGPT pilot tools when MEMORY_OS_MCP_PROFILE=chatgpt', async () => {
    const prev = process.env.MEMORY_OS_MCP_PROFILE;
    process.env.MEMORY_OS_MCP_PROFILE = 'chatgpt';
    try {
      const app = createApp({});
      const listed = await app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });
      expect(listed.status).toBe(200);
      const body = await listed.json();
      const names = (
        body.result.tools as Array<{ name: string }>
      ).map((t) => t.name);
      expect([...names].sort()).toEqual([
        'memory.search',
        'memory.get',
        'context.project',
        'capture.text',
        'memory.store_decision',
        'handoff.create',
        'memory.set_status',
      ].sort());

      const blocked = await app.request('/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'oauth.start',
            arguments: {
              workspace_id: workspaceId,
              connector_id: 'github',
              actor_subject_id: chatgpt,
            },
          },
        }),
      });
      const blockedBody = await blocked.json();
      expect(String(blockedBody.error?.message ?? '')).toMatch(
        /not available/i,
      );
    } finally {
      if (prev === undefined) delete process.env.MEMORY_OS_MCP_PROFILE;
      else process.env.MEMORY_OS_MCP_PROFILE = prev;
    }
  });

  it('searches with RRF ranking and packed context', async () => {
    const app = createApp({});
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'cursor',
      },
      body: JSON.stringify({
        query: 'Slice 01',
        project_id: projectId,
        pack_context: true,
        max_context_chars: 2_000,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ranking).toBe('hybrid-rrf');
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0]?.reason).toBe('hybrid:rrf');
    expect(body.context?.packedCount).toBeGreaterThan(0);
    expect(String(body.context?.text ?? '')).toContain('[1]');

    const emptyWindow = await app.request('/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'cursor',
      },
      body: JSON.stringify({
        query: 'Slice 01',
        project_id: projectId,
        recorded_after: '2099-01-01T00:00:00.000Z',
      }),
    });
    expect(emptyWindow.status).toBe(200);
    const emptyBody = await emptyWindow.json();
    expect(emptyBody.hits).toHaveLength(0);
  });

  it('previews extraction candidates', async () => {
    const app = createApp({});
    const res = await app.request('/v1/extraction/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'chatgpt',
      },
      body: JSON.stringify({
        title: 'Pilot',
        text: 'We keep Memory OS in eu-central-1.',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(String(body.engine)).toMatch(/extraction/);
  });

  it('runs extraction with apply flag', async () => {
    const app = createApp({});
    const res = await app.request('/v1/extraction/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'chatgpt',
      },
      body: JSON.stringify({
        title: 'Run',
        text: 'Approve selected extraction candidates in review.',
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: chatgpt,
        apply: true,
        idempotency_prefix: `extract-run-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applied).toBe(true);
    expect(body.apply?.applied).toBeGreaterThan(0);
  });

  it('applies extraction candidates into memories', async () => {
    const app = createApp({});
    const res = await app.request('/v1/extraction/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor-key': 'chatgpt',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: chatgpt,
        idempotency_prefix: `extract-apply-${Date.now()}`,
        candidates: [
          {
            title: 'Region fact',
            content: 'Primary region is eu-central-1',
            memoryType: 'fact',
            confidence: 0.8,
          },
          {
            title: 'Ship decision',
            content: 'Accept RG0 and continue M4 extraction path',
            memoryType: 'decision',
            confidence: 0.9,
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.applied).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.items).toHaveLength(2);
  });

  it('filters memories by recorded_at window', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Temporal window note',
        content: 'inside recorded_after filter',
        actor_subject_id: ownerId,
        idempotency_key: `temporal-${Date.now()}`,
      }),
    });
    const farFuture = '2099-01-01T00:00:00.000Z';
    const empty = await app.request(
      `/v1/memories?recorded_after=${encodeURIComponent(farFuture)}`,
      { headers: { 'x-subject-id': ownerId } },
    );
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json();
    expect(emptyBody.memories).toEqual([]);

    const past = '2000-01-01T00:00:00.000Z';
    const listed = await app.request(
      `/v1/memories?recorded_after=${encodeURIComponent(past)}&limit=100`,
      { headers: { 'x-subject-id': ownerId } },
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(
      body.memories.some(
        (m: { title?: string }) => m.title === 'Temporal window note',
      ),
    ).toBe(true);
  });

  it('exports full memories for owner', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Export full',
        content: 'y'.repeat(600),
        actor_subject_id: ownerId,
        idempotency_key: `export-full-${Date.now()}`,
      }),
    });
    const denied = await app.request('/v1/export/memories', {
      headers: { 'x-actor-key': 'chatgpt' },
    });
    expect(denied.status).toBe(403);
    const res = await app.request('/v1/export/memories?limit=50', {
      headers: { 'x-subject-id': ownerId, 'x-actor-key': 'owner' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('memory-os.export.memories.v1');
    expect(body.count).toBeGreaterThan(0);
    const hit = body.memories.find(
      (m: { title?: string }) => m.title === 'Export full',
    );
    expect(hit?.content?.length).toBe(600);
  });

  it('denies roma reading personal memory', async () => {
    const app = createApp({});
    const created = await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Personal note',
        content: 'Private email summary that ROMA must not read.',
        actor_subject_id: owner,
        idempotency_key: `roma-personal-${Date.now()}`,
        sensitivity: 'personal',
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    const denied = await app.request(`/v1/memories/${body.id}`, {
      headers: {
        'x-subject-id': roma,
        'x-actor-key': 'roma',
      },
    });
    expect(denied.status).toBe(403);
  });

  it('gets memory offline with full content', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const created = await app.request('/v1/memories', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        memory_type: 'fact',
        title: 'Full get',
        content: 'x'.repeat(600),
        actor_subject_id: ownerId,
        idempotency_key: `get-full-${Date.now()}`,
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    expect(body.id).toBeTruthy();
    const res = await app.request(`/v1/memories/${body.id}`, {
      headers: {
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
    });
    expect(res.status).toBe(200);
    const got = (await res.json()) as { memory: { content: string } };
    expect(got.memory.content.length).toBe(600);
  });

  it('returns provenance and evidence for captured memory', async () => {
    const app = createApp({});
    const captured = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Evidence alpha',
        text: 'Evidence should surface in memory detail.',
        actor_subject_id: chatgpt,
        idempotency_key: 'memory-detail-evidence-1',
      }),
    });
    expect(captured.status).toBe(201);
    const created = (await captured.json()) as { memoryId: string };
    const detail = await app.request(`/v1/memories/${created.memoryId}`, {
      headers: { 'x-subject-id': owner, 'x-actor-key': 'owner' },
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      memory: {
        source?: { sourceEventId?: string };
        evidence?: unknown[];
        provenance?: { origin?: string };
      };
    };
    expect(body.memory.source?.sourceEventId).toBeTruthy();
    expect(Array.isArray(body.memory.evidence)).toBe(true);
    expect(body.memory.evidence?.length).toBeGreaterThan(0);
    expect(body.memory.provenance?.origin).toBeTruthy();
  });

  it('creates and lists privacy requests for owner', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const created = await app.request('/v1/privacy/requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: ownerId,
        request_type: 'correction',
        reason: 'The date should be corrected.',
        correction_text: 'Use the updated date from the signed brief.',
        idempotency_key: 'privacy-request-1',
      }),
    });
    expect(created.status).toBe(201);
    const listed = await app.request(
      `/v1/privacy/requests?workspace_id=${workspaceId}&limit=10`,
      {
        headers: {
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].requestType).toBe('correction');
    expect(body.requests[0].correctionText).toContain('updated date');
  });

  it('corrects a memory by superseding it with an authoritative replacement', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const captured = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Correction target',
        text: 'The launch date is August 15.',
        actor_subject_id: chatgpt,
        idempotency_key: 'memory-correct-1',
      }),
    });
    expect(captured.status).toBe(201);
    const created = (await captured.json()) as { memoryId: string };

    const corrected = await app.request(`/v1/memories/${created.memoryId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        title: 'Correction target',
        content: 'The launch date is August 19.',
        reason: 'Confirmed against the signed release note.',
        actor_subject_id: ownerId,
      }),
    });
    expect(corrected.status).toBe(200);
    const correctedBody = (await corrected.json()) as {
      supersededId: string;
      authoritativeId: string;
      supersededStatus: string;
      authoritativeStatus: string;
      reason: string;
    };
    expect(correctedBody.supersededId).toBe(created.memoryId);
    expect(correctedBody.authoritativeId).not.toBe(created.memoryId);
    expect(correctedBody.supersededStatus).toBe('superseded');
    expect(correctedBody.authoritativeStatus).toBe('verified');
    expect(correctedBody.reason).toContain('signed release note');

    const superseded = await app.request(`/v1/memories/${created.memoryId}`, {
      headers: {
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
    });
    expect(superseded.status).toBe(200);
    const supersededBody = (await superseded.json()) as {
      memory: {
        status: string;
        supersededBy?: string | null;
        metadata?: Record<string, unknown>;
      };
    };
    expect(supersededBody.memory.status).toBe('superseded');
    expect(supersededBody.memory.supersededBy).toBe(correctedBody.authoritativeId);
    expect(supersededBody.memory.metadata?.correction_reason).toBe(
      'Confirmed against the signed release note.',
    );

    const authoritative = await app.request(`/v1/memories/${correctedBody.authoritativeId}`, {
      headers: {
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
    });
    expect(authoritative.status).toBe(200);
    const authoritativeBody = (await authoritative.json()) as {
      memory: {
        status: string;
        content: string;
        metadata?: Record<string, unknown>;
      };
    };
    expect(authoritativeBody.memory.status).toBe('verified');
    expect(authoritativeBody.memory.content).toContain('August 19');
    expect(authoritativeBody.memory.metadata?.corrected_from).toBe(created.memoryId);
    expect(authoritativeBody.memory.metadata?.correction_reason).toBe(
      'Confirmed against the signed release note.',
    );

    const audit = await app.request(
      `/v1/audit?workspace_id=${workspaceId}&project_id=${projectId}&limit=20`,
      {
        headers: {
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(audit.status).toBe(200);
    const auditBody = (await audit.json()) as {
      events: Array<{ action: string; reason?: string | null; afterState?: Record<string, unknown> }>;
    };
    expect(auditBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'memory.correct',
          reason: 'Confirmed against the signed release note.',
          afterState: expect.objectContaining({
            supersededId: created.memoryId,
            authoritativeId: correctedBody.authoritativeId,
          }),
        }),
      ]),
    );
  });

  it('rejects memory correction without a reason', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const captured = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Missing reason target',
        text: 'This note lacks a correction reason.',
        actor_subject_id: chatgpt,
        idempotency_key: 'memory-correct-missing-reason-1',
      }),
    });
    const created = (await captured.json()) as { memoryId: string };

    const corrected = await app.request(`/v1/memories/${created.memoryId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        content: 'Updated body without an audit reason.',
        actor_subject_id: ownerId,
      }),
    });
    expect(corrected.status).toBe(400);
    const body = await corrected.json();
    expect(String(body.error)).toContain('reason');
  });

  it('forbids non-owner memory correction', async () => {
    const app = createApp({});
    const captured = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Unauthorized correction target',
        text: 'Only the owner may correct this note.',
        actor_subject_id: chatgpt,
        idempotency_key: 'memory-correct-forbidden-1',
      }),
    });
    const created = (await captured.json()) as { memoryId: string };

    const corrected = await app.request(`/v1/memories/${created.memoryId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': cursor,
        'x-actor-key': 'cursor',
      },
      body: JSON.stringify({
        content: 'Unauthorized rewrite attempt.',
        reason: 'Cursor tried to correct an owner-only memory.',
        actor_subject_id: cursor,
      }),
    });
    expect(corrected.status).toBe(403);
  });

  it('lists audit events after status changes, handoffs, privacy, and export', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const captured = await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        title: 'Audit target',
        text: 'This captured note will be reviewed.',
        actor_subject_id: chatgpt,
        idempotency_key: 'audit-capture-1',
      }),
    });
    const captureBody = (await captured.json()) as { memoryId: string };

    await app.request(`/v1/memories/${captureBody.memoryId}/status`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        status: 'verified',
        reason: 'Reviewed by owner for audit trail',
        actor_subject_id: ownerId,
      }),
    });

    await app.request('/v1/handoffs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': cursor,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        from_subject_id: cursor,
        to_subject_id: chatgpt,
        idempotency_key: 'audit-handoff-1',
        payload: {
          completed: ['reviewed candidate memory'],
          artifacts: [],
          validation: ['api tests'],
          open_items: ['finish privacy wiring'],
          blockers: [],
          recommended_next: ['inspect audit timeline'],
        },
      }),
    });

    await app.request('/v1/privacy/requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: ownerId,
        request_type: 'deletion',
        target_memory_id: captureBody.memoryId,
        reason: 'Owner requested deletion audit trail.',
        idempotency_key: 'audit-privacy-1',
      }),
    });

    await app.request(
      `/v1/export/memories?project_id=${projectId}&limit=10`,
      {
      headers: {
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      },
    );

    const audit = await app.request(
      `/v1/audit?workspace_id=${workspaceId}&project_id=${projectId}&limit=20`,
      {
        headers: {
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(audit.status).toBe(200);
    const body = await audit.json();
    const actions = (body.events as Array<{ action: string }>).map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'memory.set_status',
        'handoff.create',
        'privacy.request.submitted',
        'memory.export',
      ]),
    );
  });

  it('returns a live agent-rights matrix', async () => {
    const app = createApp({});
    const res = await app.request(`/v1/agents/rights?workspace_id=${workspaceId}`, {
      headers: { 'x-subject-id': cursor, 'x-actor-key': 'cursor' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currentActor.subjectId).toBe(cursor);
    expect(body.actors).toHaveLength(4);
    expect(
      body.actors.some(
        (row: { externalKey?: string; rights?: unknown[] }) =>
          row.externalKey === 'cursor' && Array.isArray(row.rights) && row.rights.length > 0,
      ),
    ).toBe(true);
    expect(
      body.actors.some(
        (row: {
          externalKey?: string;
          purpose?: string;
          allowedTools?: string[];
          rights?: Array<{ resourceType?: string; actions?: string[] }>;
        }) =>
          row.externalKey === 'roma' &&
          typeof row.purpose === 'string' &&
          row.purpose.includes('QA') &&
          Array.isArray(row.allowedTools) &&
          row.allowedTools.includes('handoff.create') &&
          Array.isArray(row.rights) &&
          row.rights.some(
            (right) =>
              right.resourceType === 'handoff' &&
              Array.isArray(right.actions) &&
              right.actions.includes('write'),
          ),
      ),
    ).toBe(true);
  });

  it('embeds offline rejection without supabase gateway', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request(
      '/v1/memories/11111111-1111-4111-8111-111111111199/embed',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          actor_subject_id: ownerId,
          title: 't',
          text: 'body',
        }),
      },
    );
    expect(res.status).toBe(501);
  });

  it('embed-missing offline rejection without supabase gateway', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request('/v1/memories/embed-missing', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: ownerId,
        limit: 5,
      }),
    });
    expect(res.status).toBe(501);
  });

  it('returns empty outbox offline for owner', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const res = await app.request(
      `/v1/outbox/pending?workspace_id=${workspaceId}`,
      {
        headers: {
          'x-subject-id': ownerId,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.backend).toBe('memory-store');
  });

  it('runs offline consolidation for duplicate candidates', async () => {
    const app = createApp({});
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const common = {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: chatgpt,
      title: 'Offline consolidation twin',
      text: 'duplicate candidate for consolidation harness',
    };
    await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        ...common,
        idempotency_key: `consol/offline-a-${Date.now()}`,
      }),
    });
    await app.request('/v1/capture/text', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify({
        ...common,
        title: 'offline consolidation twin',
        idempotency_key: `consol/offline-b-${Date.now()}`,
      }),
    });
    const res = await app.request('/v1/consolidation/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': ownerId,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: ownerId,
        apply: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe('memory-store');
    expect(body.planned).toBeGreaterThanOrEqual(1);
    expect(body.applied.length).toBeGreaterThanOrEqual(1);
  });

  it('idempotently ingests events', async () => {
    const app = createApp({});
    const payload = {
      schema_version: '1.0',
      workspace_id: workspaceId,
      source: { provider: 'manual' },
      event_type: 'note.created',
      observed_at: '2026-08-11T08:00:00.000Z',
      idempotency_key: 'manual/note-1',
      content: { text: 'hello' },
      scope: {
        project_id: projectId,
        sensitivity: 'internal',
        storage_mode: 'indexed',
      },
    };
    const a = await app.request('/v1/ingestion/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify(payload),
    });
    const b = await app.request('/v1/ingestion/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': chatgpt,
      },
      body: JSON.stringify(payload),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).id).toBe((await b.json()).id);
  });

  it('rejects Apple companion ingest when project_id is omitted', async () => {
    const app = createApp({});
    const res = await app.request('/v1/ingestion/apple-items', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor_subject_id: owner,
        device_id: 'iphone-15-pro',
        item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        kind: 'text',
        title: 'Missing project',
        text: 'Should fail instead of defaulting to AISTROYKA.',
        storage_mode: 'indexed',
        sensitivity: 'internal',
        idempotency_key: 'apple-share/missing-project',
        source: 'share_extension',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'project_id is required for this write',
    });
  });

  it('accepts Apple companion ingest with a project slug and preserves provenance identifiers', async () => {
    const app = createApp({});
    const res = await app.request('/v1/ingestion/apple-items', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        project_id: 'aistroyka',
        actor_subject_id: owner,
        device_id: 'iphone-15-pro',
        item_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        kind: 'photo',
        title: 'Shared whiteboard',
        filename: 'whiteboard.jpeg',
        mime_type: 'image/jpeg',
        storage_mode: 'reference',
        sensitivity: 'internal',
        idempotency_key: 'apple-share/iphone-15-pro/whiteboard-1',
        delete_local_after_ack: true,
        process_now: false,
        source: 'share_extension',
        identifiers: {
          local_identifier: 'APPLE-LOCAL-1',
          cloud_identifier: 'APPLE-CLOUD-1',
        },
        metadata: {
          album: 'Sprint Review',
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.backend).toBe('memory-store');
    expect(body.projectId).toBe(projectId);
    expect(body.normalized.envelope.scope.project_id).toBe(projectId);
    expect(body.normalized.envelope.scope.storage_mode).toBe('reference');
    expect(body.normalized.envelope.provenance.local_identifier).toBe('APPLE-LOCAL-1');
    expect(body.normalized.envelope.provenance.cloud_identifier).toBe('APPLE-CLOUD-1');
  });

  it('lists project-scoped Apple transferred objects across companion, share, PhotoKit, and Files sources', async () => {
    const store = new MemoryStore();
    seedAppleTransferredMemory(store, {
      memoryId: '10101010-1010-4010-8010-101010101010',
      title: 'Shared whiteboard',
      source: 'share_extension',
      kind: 'photo',
      itemId: 'SHARE-1',
      filename: 'whiteboard.jpeg',
    });
    seedAppleTransferredMemory(store, {
      memoryId: '20202020-2020-4020-8020-202020202020',
      title: 'Companion note',
      source: 'companion_app',
      kind: 'text',
      itemId: 'COMPANION-1',
      text: 'Captured from the companion app.',
    });
    seedAppleTransferredMemory(store, {
      memoryId: '30303030-3030-4030-8030-303030303030',
      title: 'Selected receipt',
      source: 'photo_library',
      kind: 'photo',
      itemId: 'PHOTO-1',
      filename: 'receipt.heic',
      sensitivity: 'personal',
    });
    seedAppleTransferredMemory(store, {
      memoryId: '40404040-4040-4040-8040-404040404040',
      title: 'Picked roadmap',
      source: 'document_picker',
      kind: 'file',
      itemId: 'FILE-1',
      filename: 'roadmap.md',
    });
    store.captureText({
      workspaceId,
      projectId,
      title: 'Manual capture',
      text: 'This should not appear in Apple transferred objects.',
      actorSubjectId: owner,
      idempotencyKey: 'manual-capture-1',
    });

    const app = createApp({ store });
    const res = await app.request(
      `/v1/apple/transferred-objects?workspace_id=${workspaceId}&project_id=aistroyka&limit=10`,
      {
        headers: {
          'x-subject-id': owner,
          'x-actor-key': 'owner',
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objects).toHaveLength(4);
    expect(body.objects.map((object: { source: string }) => object.source).sort()).toEqual([
      'companion_app',
      'document_picker',
      'photo_library',
      'share_extension',
    ]);
  });

  it('rejects transferred-object listing without an explicit project_id', async () => {
    const app = createApp({ store: new MemoryStore() });
    const res = await app.request(`/v1/apple/transferred-objects?workspace_id=${workspaceId}`, {
      headers: {
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'project_id is required for this read',
    });
  });

  it('tombstones a transferred Apple object through the existing memory status path', async () => {
    const store = new MemoryStore();
    const memory = seedAppleTransferredMemory(store, {
      memoryId: '50505050-5050-4050-8050-505050505050',
      title: 'Delete me from Apple list',
      source: 'share_extension',
      kind: 'photo',
      itemId: 'DELETE-1',
      filename: 'delete-me.jpeg',
    });
    const app = createApp({ store });

    const denied = await app.request(`/v1/apple/transferred-objects/${memory.id}/delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        actor_subject_id: owner,
        reason: 'Missing project_id must fail.',
      }),
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({
      error: 'project_id is required for this write',
    });

    const deleted = await app.request(`/v1/apple/transferred-objects/${memory.id}/delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        project_id: 'aistroyka',
        actor_subject_id: owner,
        reason: 'User requested deletion from Memory OS.',
      }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual(
      expect.objectContaining({
        id: memory.id,
        status: 'deleted',
        deleted: true,
        projectId: projectId,
      }),
    );

    const listed = await app.request(
      `/v1/apple/transferred-objects?workspace_id=${workspaceId}&project_id=${projectId}&limit=10`,
      {
        headers: {
          'x-subject-id': owner,
          'x-actor-key': 'owner',
        },
      },
    );
    expect(listed.status).toBe(200);
    expect((await listed.json()).objects).toEqual([]);

    const search = await app.request('/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-subject-id': owner,
        'x-actor-key': 'owner',
      },
      body: JSON.stringify({
        query: 'Delete me from Apple list',
        project_id: projectId,
      }),
    });
    expect(search.status).toBe(200);
    expect((await search.json()).hits).toEqual([]);
  });
});

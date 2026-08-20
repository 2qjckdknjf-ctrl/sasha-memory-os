import { createHmac, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import pingFixture from './fixtures/github-webhook-ping.json';
import pushFixture from './fixtures/github-webhook-push.json';
import repositoryCreatedFixture from './fixtures/github-webhook-repository-created.json';
import { createApp } from './app.js';
import {
  isGitHubWebhookSignatureRequired,
  verifyGitHubWebhookSignature,
} from './githubWebhook.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const ownerId = '33333333-3333-4333-8333-333333333301';
const connectionId = '88888888-8888-4888-8888-888888888801';
const existingProjectId = '44444444-4444-4444-8444-444444444420';
const newProjectId = '44444444-4444-4444-8444-444444444421';
const githubAppInstallationCreatedFixture = {
  action: 'created',
  installation: {
    id: 42,
    repository_selection: 'selected',
    account: {
      id: 7,
      login: 'team',
      type: 'Organization',
      html_url: 'https://github.com/team',
    },
  },
  repositories: [
    {
      id: 1001,
      name: 'repo-new',
      full_name: 'team/repo-new',
      html_url: 'https://github.com/team/repo-new',
      description: 'New selected repository',
      default_branch: 'main',
      private: true,
      archived: false,
      owner: { login: 'team' },
    },
  ],
};
const githubAppInstallationDeletedFixture = {
  action: 'deleted',
  installation: {
    id: 42,
    repository_selection: 'selected',
    account: {
      id: 7,
      login: 'team',
      type: 'Organization',
      html_url: 'https://github.com/team',
    },
  },
};
const githubAppInstallationRepositoriesRemovedFixture = {
  action: 'removed',
  repository_selection: 'selected',
  installation: {
    id: 42,
    repository_selection: 'selected',
    account: {
      id: 7,
      login: 'team',
      type: 'Organization',
      html_url: 'https://github.com/team',
    },
  },
  repositories_added: [],
  repositories_removed: [
    {
      id: 1000,
      name: 'repo-existing',
      full_name: 'team/repo-existing',
      html_url: 'https://github.com/team/repo-existing',
      description: 'Existing repository',
      default_branch: 'main',
      private: false,
      archived: false,
      owner: { login: 'team' },
    },
  ],
};

function signGitHubWebhook(payload: unknown, secret: string) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    signature: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
  };
}

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createGatewayMock(options?: {
  excludedIds?: string[];
  metadata?: Record<string, unknown>;
  status?: string;
  initialCursor?: Record<string, unknown> | null;
}) {
  let metadataState: Record<string, unknown> = {
    collections: {
      selection_mode: 'all',
      excluded_ids: options?.excludedIds ?? [],
      items: [
        {
          id: 'team/repo-existing',
          kind: 'repository',
          name: 'repo-existing',
          title: 'team/repo-existing',
          url: 'https://github.com/team/repo-existing',
          description: 'Existing repository',
          default_branch: 'main',
          metadata: {
            owner: 'team',
            full_name: 'team/repo-existing',
            private: false,
            archived: false,
          },
        },
      ],
      project_bindings: {
        'team/repo-existing': existingProjectId,
      },
    },
    ...(options?.metadata ?? {}),
  };
  let connectionStatus = options?.status ?? 'connected';
  let cursorState =
    options?.initialCursor === undefined
      ? null
      : {
          accountId: connectionId,
          stream: 'github:webhook',
          cursor: options.initialCursor,
          schemaVersion: '1.0',
          updatedAt: '2026-08-19T18:30:00.000Z',
        };
  const buildConnection = () => ({
    id: connectionId,
    workspaceId,
    connectorId: 'github',
    displayName: 'Fixture GitHub',
    status: connectionStatus,
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
    projectBindings,
  }: {
    item: { id?: string };
    projectBindings?: Record<string, string>;
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
        items: currentCollections.items ?? [],
        project_bindings: {
          ...((currentCollections.project_bindings ?? {}) as Record<string, string>),
          ...projectBindings,
        },
      },
    };
    return buildConnection();
  });
  const getConnection = vi.fn(async () => buildConnection());
  const listConnections = vi.fn(async () => [buildConnection()]);
  const setConnectionMetadata = vi.fn(async ({ metadata }: { metadata: Record<string, unknown> }) => {
    metadataState = metadata;
    return buildConnection();
  });
  const setConnectionStatus = vi.fn(async ({ status }: { status: string }) => {
    connectionStatus = status;
    return buildConnection();
  });
  const gateway = {
    getConnection,
    listConnections,
    getConnectorCursor: vi.fn(async () => cursorState),
    refreshConnectionCollections,
    mergeConnectionProjectBindings,
    upsertConnectionCollectionItem,
    setConnectionMetadata,
    setConnectionStatus,
    upsertProjectFromConnector: vi.fn(async ({ collectionId }: { collectionId: string }) => ({
      projectId:
        collectionId === 'team/repo-new'
          ? newProjectId
          : existingProjectId,
      slug: collectionId.replace('/', '-'),
      name: collectionId,
      memoryId: `memory-${collectionId}`,
      collectionId,
    })),
    enqueueConnectorSync: vi.fn(async () => ({
      count: 1,
      enqueued: [
        {
          connectionId,
          connectorId: 'github',
          displayName: 'Fixture GitHub',
          vaultRef: null,
          jobId: 'job-1',
        },
      ],
    })),
    upsertConnectorCursor: vi.fn(async ({ cursor }: { cursor: Record<string, unknown> }) => {
      cursorState = {
        accountId: connectionId,
        stream: 'github:webhook',
        cursor,
        schemaVersion: '1.0',
        updatedAt: '2026-08-19T18:30:00.000Z',
      };
      return cursorState;
    }),
    appendAuditEvent: vi.fn(async () => ({
      id: 'audit-1',
      action: 'connection.webhook.received',
      objectType: 'connector_webhook',
      objectId: 'delivery-1',
      reason: 'github.created',
      recordedAt: '2026-08-19T18:30:00.000Z',
    })),
  };
  return {
    gateway,
    get cursorState() {
      return cursorState;
    },
    get metadataState() {
      return metadataState;
    },
    get connectionStatus() {
      return connectionStatus;
    },
  };
}

describe('githubWebhook signature', () => {
  it('allows unsigned requests only in local/test when no secret is configured', () => {
    const result = verifyGitHubWebhookSignature({
      rawBody: '{}',
      env: { MEMORY_OS_ENV: 'local' },
    });
    expect(result).toEqual({ ok: true, mode: 'unsigned_local' });
    expect(isGitHubWebhookSignatureRequired({ MEMORY_OS_ENV: 'local' })).toBe(false);
    expect(isGitHubWebhookSignatureRequired({ MEMORY_OS_ENV: 'test' })).toBe(false);
    expect(isGitHubWebhookSignatureRequired({})).toBe(true);
    expect(isGitHubWebhookSignatureRequired({ MEMORY_OS_ENV: 'production' })).toBe(true);
  });

  it('rejects unconfigured production receivers because the signature cannot be verified', () => {
    const result = verifyGitHubWebhookSignature({
      rawBody: '{}',
      env: { MEMORY_OS_ENV: 'production' },
    });
    expect(result).toEqual({ ok: false, error: 'secret_missing' });
  });

  it('treats missing or blank MEMORY_OS_ENV like production for unsigned requests', () => {
    expect(
      verifyGitHubWebhookSignature({
        rawBody: '{}',
        env: {},
      }),
    ).toEqual({ ok: false, error: 'secret_missing' });
    expect(
      verifyGitHubWebhookSignature({
        rawBody: '{}',
        env: { MEMORY_OS_ENV: '   ' },
      }),
    ).toEqual({ ok: false, error: 'secret_missing' });
  });
});

describe('github webhook api', () => {
  it('acknowledges ping with a valid signature', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const { gateway } = createGatewayMock();
        const app = createApp({ gateway: gateway as any });
        const { rawBody, signature } = signGitHubWebhook(pingFixture, 'webhook-secret');
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'ping',
            'x-github-delivery': 'delivery-ping-1',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.note).toContain('ping');
        expect(gateway.enqueueConnectorSync).not.toHaveBeenCalled();
        expect(gateway.upsertConnectorCursor).toHaveBeenCalledOnce();
      },
    );
  });

  it('binds a GitHub App installation to the pending connection without requiring connection_id', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({
          metadata: {
            github_app: {
              binding: {
                target_account_login: 'team',
              },
            },
          },
        });
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(
          githubAppInstallationCreatedFixture,
          'webhook-secret',
        );
        const res = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'installation',
            'x-github-delivery': 'delivery-installation-created-1',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.connectionId).toBe(connectionId);
        expect(body.routeMode).toBe('app');
        expect(body.enqueued).toBe(1);
        expect(state.gateway.listConnections).toHaveBeenCalledOnce();
        expect(
          state.gateway.upsertProjectFromConnector.mock.calls.map(
            ([input]: [{ collectionId: string }]) => input.collectionId,
          ),
        ).toEqual(expect.arrayContaining(['team/repo-new']));
        expect((state.metadataState.github_app as Record<string, unknown>).installation_id).toBe(42);
        expect((state.metadataState.github_app as Record<string, unknown>).repository_selection).toBe(
          'selected',
        );
        expect((state.metadataState.github_app as Record<string, unknown>).selected_repository_ids).toEqual([
          1001,
        ]);
        expect(
          (
            (state.metadataState.collections as Record<string, unknown>)
              .project_bindings as Record<string, string>
          )['team/repo-new'],
        ).toBe(newProjectId);
      },
    );
  });

  it('treats a recently seen GitHub App delivery as duplicate even when it is not the latest cursor', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({
          metadata: {
            github_app: {
              installation_id: 42,
              binding: {
                target_account_login: 'team',
              },
            },
          },
          initialCursor: {
            deliveryId: 'delivery-other',
            recentDeliveryIds: ['delivery-app-duplicate', 'delivery-other'],
          },
        });
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(
          githubAppInstallationCreatedFixture,
          'webhook-secret',
        );
        const res = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'installation',
            'x-github-delivery': 'delivery-app-duplicate',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.duplicate).toBe(true);
        expect(body.routeMode).toBe('app');
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
      },
    );
  });

  it('upserts a new repository project and enqueues sync on repository.created', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(
          repositoryCreatedFixture,
          'webhook-secret',
        );
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'repository',
            'x-github-delivery': 'delivery-created-1',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.projectId).toBe(newProjectId);
        expect(body.enqueued).toBe(1);
        expect(
          state.gateway.upsertProjectFromConnector.mock.calls.map(
            ([input]: [{ collectionId: string }]) => input.collectionId,
          ),
        ).toEqual(['team/repo-new']);
        expect(
          ((state.metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).some(
            (collection) => collection.id === 'team/repo-new',
          ),
        ).toBe(true);
        expect(
          ((state.metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).some(
            (collection) => collection.id === 'team/repo-existing',
          ),
        ).toBe(true);
        expect(
          (
            (state.metadataState.collections as Record<string, unknown>)
              .project_bindings as Record<string, string>
          )['team/repo-new'],
        ).toBe(newProjectId);
        const newRepo = (
          (state.metadataState.collections as Record<string, unknown>).items as Array<{
            id: string;
            metadata?: Record<string, unknown>;
          }>
        ).find((collection) => collection.id === 'team/repo-new');
        expect(newRepo?.metadata?.added_via).toBe('webhook');
        expect(typeof newRepo?.metadata?.added_at).toBe('string');
        expect(state.gateway.enqueueConnectorSync).toHaveBeenCalledOnce();
      },
    );
  });

  it('keeps excluded ids excluded when webhook adds a repository back into collections', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({ excludedIds: ['team/repo-new'] });
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(
          repositoryCreatedFixture,
          'webhook-secret',
        );
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'repository',
            'x-github-delivery': 'delivery-created-excluded',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(202);
        expect(state.gateway.upsertProjectFromConnector).not.toHaveBeenCalled();
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
        const body = await res.json();
        expect(String(body.note)).not.toContain('project upserted');
        expect(
          ((state.metadataState.collections as Record<string, unknown>).excluded_ids as string[]),
        ).toContain('team/repo-new');
        expect(
          ((state.metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>).map(
            (collection) => collection.id,
          ),
        ).toEqual(expect.arrayContaining(['team/repo-existing', 'team/repo-new']));
        const newRepo = (
          (state.metadataState.collections as Record<string, unknown>).items as Array<{
            id: string;
            metadata?: Record<string, unknown>;
          }>
        ).find((collection) => collection.id === 'team/repo-new');
        expect(newRepo?.metadata?.added_via).toBe('webhook');
      },
    );
  });

  it('returns a generic 500 body without leaking the internal error message', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'production',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const app = createApp({
            gateway: {
              getConnection: vi.fn(async () => {
                throw new Error('sensitive webhook failure');
              }),
            } as any,
          });
          const { rawBody, signature } = signGitHubWebhook(
            repositoryCreatedFixture,
            'webhook-secret',
          );
          const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-github-event': 'repository',
              'x-github-delivery': 'delivery-created-error',
              'x-hub-signature-256': signature,
            },
            body: rawBody,
          });
          expect(res.status).toBe(500);
          const body = await res.json();
          expect(body.error).toBe('internal_error');
          expect(JSON.stringify(body)).not.toContain('sensitive webhook failure');
        } finally {
          errorSpy.mockRestore();
        }
      },
    );
  });

  it('enqueues sync on push without creating another project binding', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(pushFixture, 'webhook-secret');
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'push',
            'x-github-delivery': 'delivery-push-1',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(202);
        expect(state.gateway.enqueueConnectorSync).toHaveBeenCalledOnce();
        expect(state.gateway.upsertProjectFromConnector).not.toHaveBeenCalled();
      },
    );
  });

  it('does not enqueue sync on push when the pushed repository is excluded', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({ excludedIds: ['team/repo-existing'] });
        const app = createApp({ gateway: state.gateway as any });
        const { rawBody, signature } = signGitHubWebhook(pushFixture, 'webhook-secret');
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'push',
            'x-github-delivery': 'delivery-push-excluded-1',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
        expect(String(body.note)).toContain('excluded');
      },
    );
  });

  it('revokes the GitHub connection on installation.deleted and skips later app-delivered push syncs', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({
          metadata: {
            github_app: {
              installation_id: 42,
              binding: {
                target_account_login: 'team',
              },
            },
          },
        });
        const app = createApp({ gateway: state.gateway as any });
        const deleted = signGitHubWebhook(githubAppInstallationDeletedFixture, 'webhook-secret');
        const deletedRes = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'installation',
            'x-github-delivery': 'delivery-installation-deleted-1',
            'x-hub-signature-256': deleted.signature,
          },
          body: deleted.rawBody,
        });
        expect(deletedRes.status).toBe(202);
        expect(state.connectionStatus).toBe('revoked');

        const pushPayload = {
          ...pushFixture,
          installation: {
            id: 42,
            repository_selection: 'selected',
            account: {
              id: 7,
              login: 'team',
              type: 'Organization',
              html_url: 'https://github.com/team',
            },
          },
        };
        const pushed = signGitHubWebhook(pushPayload, 'webhook-secret');
        const pushRes = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'push',
            'x-github-delivery': 'delivery-installation-push-after-delete',
            'x-hub-signature-256': pushed.signature,
          },
          body: pushed.rawBody,
        });
        expect(pushRes.status).toBe(202);
        const pushBody = await pushRes.json();
        expect(pushBody.enqueued).toBe(0);
        expect(String(pushBody.note)).toContain('revoked');
      },
    );
  });

  it('removes deselected repositories from the app-backed selection and skips later push syncs for them', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const state = createGatewayMock({
          metadata: {
            github_app: {
              installation_id: 42,
              repository_selection: 'selected',
              account: {
                id: 7,
                login: 'team',
                type: 'Organization',
                html_url: 'https://github.com/team',
              },
              selected_repository_ids: [1000],
              selected_repositories: [
                {
                  id: 1000,
                  name: 'repo-existing',
                  full_name: 'team/repo-existing',
                  html_url: 'https://github.com/team/repo-existing',
                  default_branch: 'main',
                  private: false,
                  archived: false,
                },
              ],
            },
          },
        });
        const app = createApp({ gateway: state.gateway as any });
        const removed = signGitHubWebhook(
          githubAppInstallationRepositoriesRemovedFixture,
          'webhook-secret',
        );
        const removedRes = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'installation_repositories',
            'x-github-delivery': 'delivery-installation-removed-1',
            'x-hub-signature-256': removed.signature,
          },
          body: removed.rawBody,
        });
        expect(removedRes.status).toBe(202);
        expect((state.metadataState.github_app as Record<string, unknown>).selected_repository_ids).toEqual([]);
        expect(
          ((state.metadataState.collections as Record<string, unknown>).items as Array<{ id: string }>),
        ).toEqual([]);

        const pushPayload = {
          ...pushFixture,
          installation: {
            id: 42,
            repository_selection: 'selected',
            account: {
              id: 7,
              login: 'team',
              type: 'Organization',
              html_url: 'https://github.com/team',
            },
          },
        };
        const pushed = signGitHubWebhook(pushPayload, 'webhook-secret');
        const pushRes = await app.request('/v1/webhooks/github', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'push',
            'x-github-delivery': 'delivery-installation-push-removed-1',
            'x-hub-signature-256': pushed.signature,
          },
          body: pushed.rawBody,
        });
        expect(pushRes.status).toBe(202);
        const pushBody = await pushRes.json();
        expect(pushBody.enqueued).toBe(0);
        expect(String(pushBody.note)).toContain('selected repositories');
      },
    );
  });

  it('reconciles a missed GitHub App delivery through the bounded delivery poll', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
        MEMORY_OS_OWNER_SUBJECT_ID: ownerId,
      },
      async () => {
        const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const state = createGatewayMock({
          metadata: {
            github_app: {
              installation_id: 42,
              repository_selection: 'selected',
              account: {
                id: 7,
                login: 'team',
                type: 'Organization',
                html_url: 'https://github.com/team',
              },
              selected_repository_ids: [1000],
              selected_repositories: [
                {
                  id: 1000,
                  name: 'repo-existing',
                  full_name: 'team/repo-existing',
                  html_url: 'https://github.com/team/repo-existing',
                },
              ],
            },
          },
          initialCursor: {
            deliveryId: 'delivery-seen',
            recentDeliveryIds: ['delivery-seen'],
          },
        });
        const fetchSpy = vi
          .fn()
          .mockResolvedValueOnce(
            Response.json([
              {
                id: 91,
                guid: 'delivery-missed-delete',
                delivered_at: '2026-08-20T00:10:00.000Z',
                redelivery: false,
                duration: 0.2,
                status: 'OK',
                status_code: 202,
                event: 'installation',
                action: 'deleted',
                installation_id: 42,
                repository_id: null,
              },
            ]),
          )
          .mockResolvedValueOnce(
            Response.json({
              id: 91,
              guid: 'delivery-missed-delete',
              delivered_at: '2026-08-20T00:10:00.000Z',
              redelivery: false,
              duration: 0.2,
              status: 'OK',
              status_code: 202,
              event: 'installation',
              action: 'deleted',
              installation_id: 42,
              repository_id: null,
              request: {
                payload: githubAppInstallationDeletedFixture,
              },
            }),
          );
        vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
        try {
          await withEnv(
            {
              MEMORY_OS_GITHUB_APP_ID: '123456',
              MEMORY_OS_GITHUB_APP_PRIVATE_KEY: privateKey
                .export({ type: 'pkcs8', format: 'pem' })
                .toString(),
            },
            async () => {
              const app = createApp({ gateway: state.gateway as any });
              const res = await app.request(`/v1/connections/${connectionId}/github/reconcile`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                },
                body: JSON.stringify({
                  actor_subject_id: ownerId,
                  max_deliveries: 10,
                }),
              });
              expect(res.status).toBe(202);
              const body = await res.json();
              expect(body.recoveredDeliveries).toBe(1);
              expect(body.replayedDeliveryIds).toEqual(['delivery-missed-delete']);
              expect(state.connectionStatus).toBe('revoked');
            },
          );
        } finally {
          vi.unstubAllGlobals();
        }
      },
    );
  });

  it('returns 401 for a bad signature', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'test',
        MEMORY_OS_GITHUB_WEBHOOK_SECRET: 'webhook-secret',
      },
      async () => {
        const app = createApp({});
        const { rawBody, signature } = signGitHubWebhook(
          repositoryCreatedFixture,
          'wrong-secret',
        );
        const res = await app.request(`/v1/webhooks/github?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-github-event': 'repository',
            'x-github-delivery': 'delivery-created-bad',
            'x-hub-signature-256': signature,
          },
          body: rawBody,
        });
        expect(res.status).toBe(401);
      },
    );
  });
});

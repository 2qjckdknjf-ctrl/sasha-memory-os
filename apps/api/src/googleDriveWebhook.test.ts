import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const connectionId = '88888888-8888-4888-8888-888888888803';

function createGatewayMock(options?: {
  status?: string;
  initialCursor?: Record<string, unknown> | null;
}) {
  let cursorState =
    options?.initialCursor === undefined
      ? null
      : {
          accountId: connectionId,
          stream: 'google-drive:watch',
          cursor: options.initialCursor,
          schemaVersion: '1.0',
          updatedAt: '2026-08-20T00:20:00.000Z',
        };
  const gateway = {
    getConnection: vi.fn(async () => ({
      id: connectionId,
      workspaceId,
      connectorId: 'google-drive',
      displayName: 'Drive pilot',
      status: options?.status ?? 'connected',
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
          project_bindings: {
            'google-drive:folder:FOLDER-1': '44444444-4444-4444-8444-444444444422',
          },
        },
      },
    })),
    getConnectorCursor: vi.fn(async () => cursorState),
    enqueueConnectorSync: vi.fn(async () => ({
      count: 1,
      enqueued: [
        {
          connectionId,
          connectorId: 'google-drive',
          displayName: 'Drive pilot',
          jobId: 'job-1',
        },
      ],
    })),
    upsertConnectorCursor: vi.fn(async ({ cursor }: { cursor: Record<string, unknown> }) => {
      cursorState = {
        accountId: connectionId,
        stream: 'google-drive:watch',
        cursor,
        schemaVersion: '1.0',
        updatedAt: '2026-08-20T00:20:01.000Z',
      };
      return cursorState;
    }),
    appendAuditEvent: vi.fn(async () => ({})),
  };
  return {
    gateway,
    get cursorState() {
      return cursorState;
    },
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

describe('google drive webhook api', () => {
  it('rejects production Drive watch deliveries without a valid token', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'production',
        MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN: 'drive-watch-secret',
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const res = await app.request(`/v1/webhooks/google-drive?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'x-goog-resource-state': 'update',
            'x-goog-channel-id': 'drive-channel-1',
            'x-goog-resource-id': 'drive-resource-1',
            'x-goog-message-number': '7',
          },
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
          error: 'unauthorized',
          reason: 'token_required',
        });
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
      },
    );
  });

  it('allows unsigned local Drive watch deliveries when no secret is configured', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN: undefined,
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const res = await app.request(`/v1/webhooks/google-drive?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'x-goog-resource-state': 'update',
            'x-goog-channel-id': 'drive-channel-local',
            'x-goog-resource-id': 'drive-resource-local',
            'x-goog-message-number': '1',
          },
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.accepted).toBe(true);
        expect(body.enqueued).toBe(1);
      },
    );
  });

  it('rejects production Drive watch deliveries with the wrong token', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'production',
        MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN: 'drive-watch-secret',
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const res = await app.request(`/v1/webhooks/google-drive?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'x-goog-resource-state': 'update',
            'x-goog-channel-id': 'drive-channel-1',
            'x-goog-resource-id': 'drive-resource-1',
            'x-goog-message-number': '7',
            'x-goog-channel-token': 'wrong-secret',
          },
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
          error: 'unauthorized',
          reason: 'token_invalid',
        });
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
      },
    );
  });

  it('acknowledges a Drive watch signal with a plain watch token and enqueues connector sync', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'production',
        MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN: 'drive-watch-secret',
      },
      async () => {
        const state = createGatewayMock();
        const app = createApp({ gateway: state.gateway as any });
        const res = await app.request(`/v1/webhooks/google-drive?connection_id=${connectionId}`, {
          method: 'POST',
          headers: {
            'x-goog-resource-state': 'update',
            'x-goog-channel-id': 'drive-channel-1',
            'x-goog-resource-id': 'drive-resource-1',
            'x-goog-message-number': '7',
            'x-goog-channel-token': 'drive-watch-secret',
          },
        });
        expect(res.status).toBe(202);
        const body = await res.json();
        expect(body.accepted).toBe(true);
        expect(body.enqueued).toBe(1);
        expect(state.gateway.enqueueConnectorSync).toHaveBeenCalledOnce();
        expect(state.gateway.upsertConnectorCursor).toHaveBeenCalledOnce();
      },
    );
  });

  it('deduplicates a valid Drive watch querystring token for the same channel/message pair', async () => {
    await withEnv(
      {
        MEMORY_OS_ENV: 'production',
        MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN: 'drive-watch-secret',
      },
      async () => {
        const state = createGatewayMock({
          initialCursor: {
            lastMessageKey: 'drive-channel-1:7',
            recentMessageKeys: ['drive-channel-1:7'],
          },
        });
        const app = createApp({ gateway: state.gateway as any });
        const res = await app.request('/v1/webhooks/google-drive', {
          method: 'POST',
          headers: {
            'x-goog-resource-state': 'update',
            'x-goog-channel-id': 'drive-channel-1',
            'x-goog-resource-id': 'drive-resource-1',
            'x-goog-message-number': '7',
            'x-goog-channel-token': `connection_id=${connectionId}&watch_token=drive-watch-secret`,
          },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.duplicate).toBe(true);
        expect(state.gateway.enqueueConnectorSync).not.toHaveBeenCalled();
      },
    );
  });
});

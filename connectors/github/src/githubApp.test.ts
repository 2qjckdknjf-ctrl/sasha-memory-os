import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createGitHubAppJwt,
  listGitHubAppWebhookDeliveries,
  reconcileGitHubAppWebhookDeliveries,
} from './githubApp.js';

function createAppCredentials() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    appId: '123456',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

describe('createGitHubAppJwt', () => {
  it('creates a three-part RS256 token for app-authenticated webhook APIs', () => {
    const jwt = createGitHubAppJwt({
      ...createAppCredentials(),
      now: Date.parse('2026-08-20T00:00:00.000Z'),
    });
    expect(jwt.split('.')).toHaveLength(3);
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

describe('listGitHubAppWebhookDeliveries', () => {
  it('extracts the next cursor from the Link header', async () => {
    const credentials = createAppCredentials();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([]), {
        headers: {
          link: '<https://api.github.com/app/hook/deliveries?cursor=next-cursor>; rel="next"',
        },
      }),
    );

    const result = await listGitHubAppWebhookDeliveries({
      ...credentials,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.nextCursor).toBe('next-cursor');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('reconcileGitHubAppWebhookDeliveries', () => {
  it('replays only unseen deliveries for the bound installation and selected repositories', async () => {
    const credentials = createAppCredentials();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 10,
              guid: 'delivery-seen',
              delivered_at: '2026-08-20T00:10:00.000Z',
              redelivery: false,
              duration: 0.2,
              status: 'OK',
              status_code: 202,
              event: 'push',
              action: null,
              installation_id: 42,
              repository_id: 101,
            },
            {
              id: 11,
              guid: 'delivery-missed',
              delivered_at: '2026-08-20T00:09:00.000Z',
              redelivery: false,
              duration: 0.2,
              status: 'OK',
              status_code: 202,
              event: 'pull_request',
              action: 'opened',
              installation_id: 42,
              repository_id: 101,
            },
            {
              id: 12,
              guid: 'delivery-other-installation',
              delivered_at: '2026-08-20T00:08:00.000Z',
              redelivery: false,
              duration: 0.2,
              status: 'OK',
              status_code: 202,
              event: 'push',
              action: null,
              installation_id: 77,
              repository_id: 101,
            },
            {
              id: 13,
              guid: 'delivery-installation-repositories',
              delivered_at: '2026-08-20T00:07:00.000Z',
              redelivery: false,
              duration: 0.2,
              status: 'OK',
              status_code: 202,
              event: 'installation_repositories',
              action: 'added',
              installation_id: 42,
              repository_id: null,
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 11,
          guid: 'delivery-missed',
          delivered_at: '2026-08-20T00:09:00.000Z',
          redelivery: false,
          duration: 0.2,
          status: 'OK',
          status_code: 202,
          event: 'pull_request',
          action: 'opened',
          installation_id: 42,
          repository_id: 101,
          request: { payload: { action: 'opened' } },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 13,
          guid: 'delivery-installation-repositories',
          delivered_at: '2026-08-20T00:07:00.000Z',
          redelivery: false,
          duration: 0.2,
          status: 'OK',
          status_code: 202,
          event: 'installation_repositories',
          action: 'added',
          installation_id: 42,
          repository_id: null,
          request: { payload: { action: 'added' } },
        }),
      );

    const result = await reconcileGitHubAppWebhookDeliveries({
      ...credentials,
      installationId: 42,
      selectedRepositoryIds: [101],
      seenDeliveryIds: ['delivery-seen'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxDeliveries: 25,
    });

    expect(result.inspectedCount).toBe(4);
    expect(result.matchedCount).toBe(3);
    expect(result.deliveries.map((delivery) => delivery.guid)).toEqual([
      'delivery-installation-repositories',
      'delivery-missed',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

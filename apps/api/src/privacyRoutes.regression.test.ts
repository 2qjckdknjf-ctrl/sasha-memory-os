import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseMemoryGateway } from '@memory-os/db';
import { createApp } from './app.js';

const owner = '33333333-3333-4333-8333-333333333301';
const agent = '33333333-3333-4333-8333-333333333302';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444402';
const requestId = '99999999-0000-4000-8000-000000000498';
const executePath = `/v1/privacy/requests/${requestId}/execute`;
const secret = 'privacy-regression-test-secret';

function setup() {
  const gateway = {
    executePrivacyRequest: vi.fn(async () => ({ id: requestId, status: 'completed' })),
    runRetentionPolicy: vi.fn(async () => ({ dryRun: true })),
    listPrivacyRequests: vi.fn(async () => ({ requests: [] })),
    createPrivacyRequest: vi.fn(async () => ({ id: requestId })),
    exportPrivacyBundle: vi.fn(),
  };
  return {
    gateway,
    app: createApp({ gateway: gateway as unknown as SupabaseMemoryGateway }),
  };
}

function executeRequest(headers: Record<string, string> = {}, actor = owner) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ actor_subject_id: actor }),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('privacy production authentication', () => {
  it.each(['production', 'staging'])('rejects spoofed owner operations in %s before parsing the body', async (environment) => {
    vi.stubEnv('MEMORY_OS_ENV', environment);
    vi.stubEnv('MEMORY_OS_REQUIRE_API_AUTH', '');
    vi.stubEnv('MEMORY_OS_API_SECRET', secret);
    const { app, gateway } = setup();
    const routes = [
      ['GET', '/v1/privacy/requests'],
      ['POST', '/v1/privacy/requests'],
      ['POST', executePath],
      ['POST', '/v1/privacy/retention/run'],
    ];

    for (const [method, path] of routes) {
      for (const provided of [undefined, 'wrong-secret']) {
        const headers: Record<string, string> = { 'x-subject-id': owner, 'x-actor-key': 'owner' };
        if (provided) headers['x-memory-os-api-secret'] = provided;
        const response = await app.request(path, {
          method,
          headers,
          ...(method === 'POST' ? { body: '{invalid-json' } : {}),
        });
        expect(response.status, `${method} ${path}`).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
      }
    }
    for (const call of Object.values(gateway)) expect(call).not.toHaveBeenCalled();
  });

  it('rejects a default-owner execution without a secret', async () => {
    vi.stubEnv('MEMORY_OS_REQUIRE_API_AUTH', '1');
    vi.stubEnv('MEMORY_OS_API_SECRET', secret);
    const { app, gateway } = setup();
    const response = await app.request(executePath, executeRequest());
    expect(response.status).toBe(401);
    expect(gateway.executePrivacyRequest).not.toHaveBeenCalled();
  });

  it.each(['header', 'bearer'])('allows authenticated owner execution using %s', async (transport) => {
    vi.stubEnv('MEMORY_OS_REQUIRE_API_AUTH', '1');
    vi.stubEnv('MEMORY_OS_API_SECRET', secret);
    const { app, gateway } = setup();
    const credentials = transport === 'header'
      ? { 'x-memory-os-api-secret': secret }
      : { authorization: `Bearer ${secret}` };
    const response = await app.request(executePath, executeRequest({
      ...credentials, 'x-subject-id': owner,
    }));
    expect(response.status).toBe(200);
    expect(gateway.executePrivacyRequest).toHaveBeenCalledExactlyOnceWith({
      subjectId: owner, requestId,
    });
  });

  it('preserves the owner boundary after authenticating the transport', async () => {
    vi.stubEnv('MEMORY_OS_REQUIRE_API_AUTH', '1');
    vi.stubEnv('MEMORY_OS_API_SECRET', secret);
    const { app, gateway } = setup();
    const response = await app.request(executePath, executeRequest({
      'x-memory-os-api-secret': secret, 'x-subject-id': agent,
    }, agent));
    expect(response.status).toBe(403);
    expect(gateway.executePrivacyRequest).not.toHaveBeenCalled();
  });

  it('fails closed when production has no configured secret', async () => {
    vi.stubEnv('MEMORY_OS_ENV', 'production');
    vi.stubEnv('MEMORY_OS_REQUIRE_API_AUTH', '');
    vi.stubEnv('MEMORY_OS_API_SECRET', '');
    const { app, gateway } = setup();
    const response = await app.request(executePath, executeRequest({ 'x-memory-os-api-secret': secret }));
    expect(response.status).toBe(401);
    expect(gateway.executePrivacyRequest).not.toHaveBeenCalled();
  });
});

describe('privacy export and execution contracts', () => {
  it.each(['2026-11-26T22:23:17.123456Z', '2026-11-26T22:23:17.123456+00:00'])(
    'completes another export page without rounding the database snapshot %s', async (snapshotAt) => {
      const { app, gateway } = setup();
      const exportId = '99999999-0000-4000-8000-000000000499';
      gateway.exportPrivacyBundle.mockImplementation(async (input) => {
        if (input.offset && input.snapshotAt !== snapshotAt) {
          throw new Error('privacy export snapshot mismatch');
        }
        return {
          exportId, snapshotAt,
          pagination: { nextOffset: input.offset ? null : 500, hasMore: !input.offset },
        };
      });
      const query = `/v1/export/privacy?workspace_id=${workspaceId}&project_id=${projectId}`;
      const first = await app.request(query, { headers: { 'x-subject-id': owner } });
      expect(first.status).toBe(200);
      const cursor = await first.json();
      const next = await app.request(`${query}&offset=${cursor.pagination.nextOffset}&export_id=${cursor.exportId}&snapshot_at=${encodeURIComponent(cursor.snapshotAt)}`, {
        headers: { 'x-subject-id': owner },
      });
      expect(next.status).toBe(200);
      expect((await next.json()).pagination.hasMore).toBe(false);
      expect(gateway.exportPrivacyBundle).toHaveBeenLastCalledWith(expect.objectContaining({
        offset: 500, snapshotAt, exportId,
      }));
    },
  );

  it.each(['memory target not found in project', 'connector target not found in workspace'])(
    'reports a conflict for an existing request with %s', async (message) => {
      const { app, gateway } = setup();
      gateway.executePrivacyRequest.mockRejectedValue({ code: 'P0002', message });
      const response = await app.request(executePath, executeRequest());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: 'privacy_request_target_not_found' });
    },
  );

  it('reports 404 only when the privacy request itself is missing', async () => {
    const { app, gateway } = setup();
    gateway.executePrivacyRequest.mockRejectedValue({ code: 'P0002', message: 'privacy request not found' });
    const response = await app.request(executePath, executeRequest());
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'privacy_request_not_found' });
  });

  it('does not turn an unrelated missing database object into a missing request', async () => {
    const { app, gateway } = setup();
    gateway.executePrivacyRequest.mockRejectedValue(new Error('P0002: relation not found'));
    const response = await app.request(executePath, executeRequest());
    expect(response.status).toBe(500);
  });
});

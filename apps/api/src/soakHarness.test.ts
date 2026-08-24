import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import { getSloBudgetSnapshot, resetSloObservations } from '@memory-os/observability';
import { createApp } from './app.js';
import {
  boundedSoakConfigInputFromEnv,
  OFFICIAL_M14_BOUNDED_SOAK_RECIPE,
  OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION,
  resolveBoundedSoakConfig,
  resolveBoundedSoakConfigFromEnv,
  runBoundedSoakRecipe,
} from './soakHarness.js';

const projectId = '44444444-4444-4444-8444-444444444402';
const workspaceId = '11111111-1111-4111-8111-111111111111';

function createRecordingSoakClient() {
  const requests: Array<{
    url: string;
    method: string;
    body: string | null;
  }> = [];

  return {
    requests,
    client: {
      async request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const body = typeof init?.body === 'string' ? init.body : null;
        requests.push({ url, method, body });

        if (url.endsWith('/mcp/health')) {
          return new Response(
            JSON.stringify({
              ok: true,
              backend: 'memory-store',
              profile: 'chatgpt',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/health')) {
          return new Response(
            JSON.stringify({
              ok: true,
              backend: 'memory-store',
              mcpProfile: 'chatgpt',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/mcp') && method === 'GET') {
          return new Response(
            JSON.stringify({ error: 'method_not_allowed', allow: ['POST'] }),
            { status: 405, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/mcp') && method === 'POST') {
          const payload = JSON.parse(body ?? '{}') as {
            id?: string | number | null;
            method?: string;
            params?: { name?: string };
          };
          if (payload.method === 'initialize') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id ?? null,
                result: {
                  protocolVersion: '2025-03-26',
                  serverInfo: { profile: 'chatgpt' },
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          if (payload.method === 'tools/list') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id ?? null,
                result: {
                  tools: CHATGPT_PILOT_TOOLS.map((name) => ({ name })),
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          if (payload.method === 'tools/call') {
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: payload.id ?? null,
                result: {
                  structuredContent:
                    payload.params?.name === 'capture.text'
                      ? { memoryId: 'candidate-memory-id', status: 'candidate' }
                      : {},
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
        }
        if (url.includes('/v1/search')) {
          return new Response(JSON.stringify({ hits: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/v1/projects/') && url.endsWith('/state')) {
          return new Response(JSON.stringify({ version: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/v1/capture/text')) {
          return new Response(JSON.stringify({ memoryId: 'candidate-memory-id' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }

        throw new Error(`unexpected request: ${method} ${url}`);
      },
    },
  };
}

describe('bounded soak harness', () => {
  afterEach(() => {
    resetSloObservations();
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 02 recipe as versioned and bounded', () => {
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION).toBe('m14-s02-v1');
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE.version).toBe('m14-s02-v1');
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE.roadmapSections).toEqual([
      '17.2',
      '17.3',
      '20.17',
    ]);
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE.bounds).toMatchObject({
      defaultConcurrency: 2,
      maxConcurrency: 3,
      defaultRounds: 2,
      maxRounds: 2,
      defaultRequestTimeoutMs: 3000,
      maxRequestTimeoutMs: 4000,
    });
    expect(OFFICIAL_M14_BOUNDED_SOAK_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
      requireExplicitProjectIdOnWrites: true,
      allowVerifiedWrites: false,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      logPayloadBodies: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);

    expect(() =>
      resolveBoundedSoakConfig({
        projectId,
        concurrency: 4,
      }),
    ).toThrow(/bounded soak recipe/i);
    expect(() =>
      resolveBoundedSoakConfig({
        projectId,
        rounds: 3,
      }),
    ).toThrow(/bounded soak recipe/i);
  });

  it('requires an explicit project_id and ignores default project fallback env', () => {
    expect(() =>
      resolveBoundedSoakConfigFromEnv({
        MEMORY_OS_API_BASE_URL: 'http://localhost:8787',
        MEMORY_OS_DEFAULT_PROJECT_ID: projectId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('merges raw env input with flags so cli-only project_id still resolves', () => {
    const merged = resolveBoundedSoakConfig({
      ...boundedSoakConfigInputFromEnv({
        MEMORY_OS_API_BASE_URL: 'http://localhost:8787',
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: projectId,
      }),
      projectId,
    });

    expect(merged.projectId).toBe(projectId);
    expect(merged.workspaceId).toBe(workspaceId);

    expect(() =>
      resolveBoundedSoakConfig({
        ...boundedSoakConfigInputFromEnv({
          MEMORY_OS_API_BASE_URL: 'http://localhost:8787',
          MEMORY_OS_WORKSPACE_ID: workspaceId,
        }),
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('runs a bounded burst against API and MCP paths and records SLO observations', async () => {
    vi.stubEnv('MEMORY_OS_MCP_PROFILE', 'chatgpt');
    const app = createApp({});

    const report = await runBoundedSoakRecipe(
      { request: app.request.bind(app) },
      {
        baseUrl: 'http://memory-os.test',
        projectId,
        workspaceId,
      },
    );

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.preflight.modeATools).toEqual([...CHATGPT_PILOT_TOOLS].sort());
    expect(report.summary.api.total).toBe(6);
    expect(report.summary.mcp.total).toBe(6);

    const snapshot = getSloBudgetSnapshot();
    const byId = Object.fromEntries(snapshot.targets.map((target) => [target.id, target]));
    expect(byId['api.availability']?.observations).toMatchObject({
      totalCount: 6,
      errorCount: 0,
    });
    expect(byId['mcp.availability']?.observations).toMatchObject({
      totalCount: 6,
      errorCount: 0,
    });
    expect(byId['search.hybrid']?.observations).toMatchObject({
      sampleCount: 4,
    });
    expect(byId['project.state']?.observations).toMatchObject({
      sampleCount: 4,
    });
    expect(byId['write.receipt']?.observations).toMatchObject({
      sampleCount: 4,
    });
  });

  it('passes the resolved workspace_id on every MCP tool call in the burst', async () => {
    const { client, requests } = createRecordingSoakClient();

    const report = await runBoundedSoakRecipe(client, {
      baseUrl: 'http://memory-os.test',
      projectId,
      workspaceId,
      rounds: 1,
    });

    expect(report.assertions.ok).toBe(true);

    const mcpToolCalls = requests
      .filter((request) => request.url.endsWith('/mcp') && request.method === 'POST')
      .map((request) => JSON.parse(request.body ?? '{}') as {
        method?: string;
        params?: {
          name?: string;
          arguments?: Record<string, unknown>;
        };
      })
      .filter((payload) => payload.method === 'tools/call');

    expect(mcpToolCalls).toHaveLength(3);
    expect(mcpToolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'memory.search',
            arguments: expect.objectContaining({
              workspace_id: workspaceId,
            }),
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'context.project',
            arguments: expect.objectContaining({
              workspace_id: workspaceId,
            }),
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            name: 'capture.text',
            arguments: expect.objectContaining({
              workspace_id: workspaceId,
            }),
          }),
        }),
      ]),
    );
  });

  it('does not leak payload markers and does not create verified writes during the soak', async () => {
    vi.stubEnv('MEMORY_OS_MCP_PROFILE', 'chatgpt');
    const store = createSeededStore();
    const app = createApp({ store });
    const initialVerifiedCount = [...store.memories.values()].filter(
      (memory) => memory.status === 'verified',
    ).length;

    const report = await runBoundedSoakRecipe(
      { request: app.request.bind(app) },
      {
        baseUrl: 'http://memory-os.test',
        projectId,
        workspaceId,
        rounds: 1,
        searchQuery: 'private-soak-query-top-secret',
        captureTitle: 'private-soak-title',
        captureText: 'private-soak-body-top-secret',
        idempotencyNamespace: 'm14-s02-test',
      },
    );

    expect(report.assertions.ok).toBe(true);

    const snapshot = getSloBudgetSnapshot();
    const serializedSnapshot = JSON.stringify(snapshot);
    const serializedReport = JSON.stringify(report);
    expect(serializedSnapshot).not.toContain('private-soak-query-top-secret');
    expect(serializedSnapshot).not.toContain('private-soak-body-top-secret');
    expect(serializedReport).not.toContain('private-soak-query-top-secret');
    expect(serializedReport).not.toContain('private-soak-body-top-secret');

    const newSoakMemories = [...store.memories.values()].filter(
      (memory) => memory.title === 'private-soak-title',
    );
    expect(newSoakMemories).toHaveLength(2);
    expect(newSoakMemories.every((memory) => memory.status === 'candidate')).toBe(true);

    const verifiedCountAfter = [...store.memories.values()].filter(
      (memory) => memory.status === 'verified',
    ).length;
    expect(verifiedCountAfter).toBe(initialVerifiedCount);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import { getSloBudgetSnapshot, resetSloObservations } from '@memory-os/observability';
import { createApp } from './app.js';
import {
  OFFICIAL_M14_BOUNDED_SOAK_RECIPE,
  OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION,
  resolveBoundedSoakConfig,
  resolveBoundedSoakConfigFromEnv,
  runBoundedSoakRecipe,
} from './soakHarness.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';

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

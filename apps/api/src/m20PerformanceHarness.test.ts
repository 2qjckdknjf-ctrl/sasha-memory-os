import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import {
  evaluateM20PerformanceSoak,
  runM20PerformanceSoak,
} from './m20PerformanceHarness.js';

const projectId = '44444444-4444-4444-8444-444444444402';
const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('M20.3 performance soak', () => {
  it('runs the official 60-operation API/MCP gate without verified writes', async () => {
    vi.stubEnv('MEMORY_OS_MCP_PROFILE', 'chatgpt');
    const app = createApp({});
    const report = await runM20PerformanceSoak(
      { request: app.request.bind(app) },
      {
        baseUrl: 'http://memory-os.test',
        projectId,
        workspaceId,
      },
    );

    expect(report).toMatchObject({
      version: 'm20-s03-v1',
      totalOperations: 65,
      apiFailures: 0,
      mcpFailures: 0,
      assertions: { ok: true, errors: [] },
    });
    expect(report.targets['search.hybrid'].samples).toBe(20);
    expect(report.targets['search.agentic'].samples).toBe(5);
    expect(report.targets['project.state'].samples).toBe(20);
    expect(report.targets['write.receipt'].samples).toBe(20);
  });

  it('fails closed below the official operation floor', () => {
    expect(
      evaluateM20PerformanceSoak({
        version: 'm20-s03-v1',
        config: {
          projectId,
          waves: 1,
          roundsPerWave: 2,
          concurrencyPerWave: 3,
        },
        totalOperations: 12,
        apiFailures: 0,
        mcpFailures: 0,
        targets: {
          'search.hybrid': { samples: 4, p95Ms: 1 },
          'search.agentic': { samples: 1, p95Ms: 1 },
          'project.state': { samples: 4, p95Ms: 1 },
          'write.receipt': { samples: 4, p95Ms: 1 },
        },
      }),
    ).toContain('soak operation floor missed (12 < 60)');
  });

  it('fails closed when bounded agentic retrieval exceeds its declared p95', () => {
    expect(
      evaluateM20PerformanceSoak({
        version: 'm20-s03-v1',
        config: {
          projectId,
          waves: 5,
          roundsPerWave: 2,
          concurrencyPerWave: 3,
        },
        totalOperations: 65,
        apiFailures: 0,
        mcpFailures: 0,
        targets: {
          'search.hybrid': { samples: 20, p95Ms: 1 },
          'search.agentic': { samples: 5, p95Ms: 8_001 },
          'project.state': { samples: 20, p95Ms: 1 },
          'write.receipt': { samples: 20, p95Ms: 1 },
        },
      }),
    ).toContain('search.agentic p95 exceeded (8001ms > 8000ms)');
  });
});

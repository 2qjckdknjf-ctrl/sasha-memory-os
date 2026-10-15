import { describe, expect, it } from 'vitest';
import { runM20LiveReadOnlyRetrieval } from './m20LiveRetrieval.js';

const baseInput = {
  baseUrl: 'https://memory-os.test/functions/v1/memory-mcp',
  apiSecret: 'test-secret',
  projectId: '44444444-4444-4444-8444-444444444402',
};

describe('M20.3 live read-only retrieval gate', () => {
  it('runs only explicit-project memory.search calls and reports sanitized latency', async () => {
    const payloads: unknown[] = [];
    const report = await runM20LiveReadOnlyRetrieval({
      ...baseInput,
      samples: 4,
      concurrency: 2,
      client: {
        async request(_input, init) {
          payloads.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: false } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    });

    expect(report).toMatchObject({ warmupMs: expect.any(Number), samples: 4, failed: 0, ok: true });
    expect(payloads).toHaveLength(5);
    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'tools/call',
          params: expect.objectContaining({
            name: 'memory.search',
            arguments: expect.objectContaining({
              project_id: baseInput.projectId,
              pack_context: false,
            }),
          }),
        }),
      ]),
    );
  });

  it('fails closed on an MCP error without exposing the response body', async () => {
    const report = await runM20LiveReadOnlyRetrieval({
      ...baseInput,
      samples: 1,
      client: {
        async request() {
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'private body' } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    });
    expect(report).toMatchObject({ warmupMs: null, samples: 0, failed: 2, ok: false });
    expect(JSON.stringify(report)).not.toContain('private body');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatM20LiveRetrievalFailure, runM20LiveReadOnlyRetrieval } from './m20LiveRetrieval.js';

const input = {
  baseUrl: 'https://private-endpoint.example.test/functions/v1/memory-mcp',
  apiSecret: 'private-api-secret-fixture',
  projectId: '44444444-4444-4444-8444-444444444402',
};
const sensitive = 'private response, query, or exception details';
const success = () => new Response(JSON.stringify({ result: { isError: false } }));

afterEach(() => vi.restoreAllMocks());

describe('M20 live retrieval failure diagnostics', () => {
  it('identifies the failed sample without hiding it behind an acceptable p95 or retrying', async () => {
    let now = 0;
    let calls = 0;
    const deadlines: number[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      deadlines.push(milliseconds);
      return new AbortController().signal;
    });
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      client: {
        async request() {
          calls += 1;
          now += calls === 13 ? 4_000 : 1_751;
          if (calls === 13) throw new DOMException(sensitive, 'TimeoutError');
          return success();
        },
      },
    });

    expect(calls).toBe(13); // One warm-up and twelve measured attempts; no retry.
    expect(deadlines).toEqual(Array(13).fill(4_000));
    expect(report).toMatchObject({
      warmupMs: 1_751, samples: 11, failed: 1, p95Ms: 1_751,
      thresholdMs: 2_000, ok: false,
      failures: [{
        sampleIndex: 12, phase: 'request', failureClass: 'timeout',
        httpStatus: null, durationMs: 4_000,
      }],
    });
    for (const privateValue of [sensitive, input.apiSecret, input.baseUrl, input.projectId, 'M20 release gate']) {
      expect(JSON.stringify(report)).not.toContain(privateValue);
    }
  });

  it.each([
    { label: 'non-JSON HTTP failure', status: 503, body: sensitive, failureClass: 'http_error', phase: 'response_body' },
    { label: 'invalid JSON on HTTP success', status: 200, body: sensitive, failureClass: 'invalid_json', phase: 'response_body' },
    { label: 'JSON-RPC error', status: 200, body: JSON.stringify({ error: { message: sensitive } }), failureClass: 'rpc_error', phase: 'response_contract' },
    { label: 'MCP tool error', status: 200, body: JSON.stringify({ result: { isError: true, content: [{ text: sensitive }] } }), failureClass: 'tool_error', phase: 'response_contract' },
    { label: 'missing result', status: 200, body: JSON.stringify({ private: sensitive }), failureClass: 'invalid_response', phase: 'response_contract' },
    { label: 'null response', status: 200, body: 'null', failureClass: 'invalid_response', phase: 'response_contract' },
  ])('classifies $label using metadata only', async ({ status, body, failureClass, phase }) => {
    let calls = 0;
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      samples: 1,
      client: {
        async request() {
          return ++calls === 1 ? success() : new Response(body, { status });
        },
      },
    });
    expect(report).toMatchObject({ samples: 0, failed: 1, ok: false });
    expect(report.failures).toEqual([{
      sampleIndex: 1, phase, failureClass, httpStatus: status,
      durationMs: expect.any(Number),
    }]);
    expect(JSON.stringify(report)).not.toContain(sensitive);
  });

  it('records a network error without copying its untrusted message, name, or cause', async () => {
    let calls = 0;
    const error = new Error(`${sensitive} ${input.apiSecret} ${input.baseUrl}`, {
      cause: { headers: { authorization: input.apiSecret } },
    });
    error.name = sensitive;
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      samples: 1,
      client: {
        async request() {
          if (++calls === 2) throw error;
          return success();
        },
      },
    });
    expect(report.failures).toEqual([{
      sampleIndex: 1, phase: 'request', failureClass: 'transport_error',
      httpStatus: null, durationMs: expect.any(Number),
    }]);
    expect(JSON.stringify(report)).not.toMatch(/private|authorization|headers|cause/);
  });

  it('distinguishes a timed-out response body from a request that never returned headers', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => controller.signal);
    const response = success();
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort(new DOMException(sensitive, 'TimeoutError'));
      throw new DOMException(sensitive, 'AbortError');
    });
    let calls = 0;
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      samples: 1,
      client: { async request() { return ++calls === 1 ? success() : response; } },
    });
    expect(report.failures).toEqual([{
      sampleIndex: 1, phase: 'response_body', failureClass: 'timeout',
      httpStatus: 200, durationMs: expect.any(Number),
    }]);
    expect(JSON.stringify(report)).not.toContain(sensitive);
  });

  it('keeps a failed warm-up fatal even when every measured sample succeeds', async () => {
    let calls = 0;
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      samples: 2,
      client: {
        async request() {
          if (++calls === 1) throw new DOMException(sensitive, 'AbortError');
          return success();
        },
      },
    });
    expect(report).toMatchObject({ warmupMs: null, samples: 2, failed: 1, ok: false });
    expect(report.failures).toEqual([{
      sampleIndex: 0, phase: 'request', failureClass: 'aborted',
      httpStatus: null, durationMs: expect.any(Number),
    }]);
    expect(calls).toBe(3);
  });

  it('retains the 2-second threshold when all twelve requests succeed', async () => {
    let now = 0;
    let calls = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const report = await runM20LiveReadOnlyRetrieval({
      ...input,
      client: { async request() { calls += 1; now += 2_001; return success(); } },
    });
    expect(calls).toBe(13);
    expect(report).toMatchObject({
      samples: 12, failed: 0, p95Ms: 2_001, thresholdMs: 2_000, ok: false,
      failures: [],
    });
  });

  it('emits only the CLI metadata allowlist even when an input record has extra fields', () => {
    const record = {
      sampleIndex: 12, phase: 'request' as const, failureClass: 'transport_error' as const,
      httpStatus: null, durationMs: 4_000,
      responseBody: sensitive, endpoint: input.baseUrl, apiSecret: input.apiSecret,
    };
    expect(formatM20LiveRetrievalFailure(record)).toBe(
      'm20_live_retrieval_failure={"sampleIndex":12,"phase":"request","failureClass":"transport_error","httpStatus":null,"durationMs":4000}',
    );
  });
});

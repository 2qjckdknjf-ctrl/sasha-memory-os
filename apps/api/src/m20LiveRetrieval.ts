const LIVE_READ_ONLY_SAMPLES = 12;
const LIVE_READ_ONLY_CONCURRENCY = 1;
const HYBRID_P95_THRESHOLD_MS = 2_000;

type LiveRetrievalClient = {
  request(
    input: string | URL | Request,
    init?: RequestInit | undefined,
  ): Promise<Response>;
};

export type M20LiveRetrievalFailure = {
  /** Zero is the warm-up; measured samples are numbered from one. */
  sampleIndex: number;
  phase: 'request' | 'response_body' | 'response_contract';
  failureClass: 'timeout' | 'aborted' | 'transport_error' | 'http_error' |
    'invalid_json' | 'rpc_error' | 'tool_error' | 'invalid_response';
  httpStatus: number | null;
  durationMs: number;
};

export type M20LiveRetrievalReport = {
  warmupMs: number | null;
  samples: number;
  failed: number;
  p95Ms: number;
  thresholdMs: number;
  ok: boolean;
  failures: M20LiveRetrievalFailure[];
};

/** Explicit metadata allowlist: never serialize errors, headers, URLs, or payloads. */
export function formatM20LiveRetrievalFailure(failure: M20LiveRetrievalFailure): string {
  return `m20_live_retrieval_failure=${JSON.stringify({
    sampleIndex: failure.sampleIndex,
    phase: failure.phase,
    failureClass: failure.failureClass,
    httpStatus: failure.httpStatus,
    durationMs: failure.durationMs,
  })}`;
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ??
    Number.POSITIVE_INFINITY;
}

async function runConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (index < values.length) {
        const value = values[index];
        index += 1;
        if (value === undefined) return;
        await worker(value);
      }
    }),
  );
}

export async function runM20LiveReadOnlyRetrieval(input: {
  client: LiveRetrievalClient;
  baseUrl: string;
  apiSecret: string;
  projectId: string;
  samples?: number;
  concurrency?: number;
  timeoutMs?: number;
}): Promise<M20LiveRetrievalReport> {
  const samples = input.samples ?? LIVE_READ_ONLY_SAMPLES;
  const concurrency = input.concurrency ?? LIVE_READ_ONLY_CONCURRENCY;
  const timeoutMs = input.timeoutMs ?? 4_000;
  if (!input.baseUrl.trim() || !input.apiSecret.trim() || !input.projectId.trim()) {
    throw new Error('live retrieval requires baseUrl, apiSecret, and explicit projectId');
  }
  if (!Number.isInteger(samples) || samples <= 0 || samples > 24) {
    throw new Error('live retrieval samples must be an integer from 1 to 24');
  }
  if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 4) {
    throw new Error('live retrieval concurrency must be an integer from 1 to 4');
  }

  const endpoint = `${input.baseUrl.replace(/\/+$/g, '')}/mcp`;
  const durations: number[] = [];
  const failures: M20LiveRetrievalFailure[] = [];
  const executeSample = async (sample: number): Promise<number | null> => {
    const startedAt = performance.now();
    let phase: M20LiveRetrievalFailure['phase'] = 'request';
    let httpStatus: number | null = null;
    let httpOk: boolean | undefined;
    let signal: AbortSignal | undefined;
    const fail = (failureClass: M20LiveRetrievalFailure['failureClass']): null => {
      failures.push({
        sampleIndex: sample,
        phase,
        failureClass,
        httpStatus,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      return null;
    };
    try {
      signal = AbortSignal.timeout(timeoutMs);
      const response = await input.client.request(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'x-memory-os-api-secret': input.apiSecret,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: sample,
          method: 'tools/call',
          params: {
            name: 'memory.search',
            arguments: {
              query: 'M20 release gate',
              project_id: input.projectId,
              pack_context: false,
            },
          },
        }),
        signal,
      });
      httpStatus = response.status;
      httpOk = response.ok;
      phase = 'response_body';
      const body = (await response.json()) as {
        error?: unknown;
        result?: { isError?: boolean };
      } | null;
      phase = 'response_contract';
      if (!httpOk) return fail('http_error');
      if (body?.error) return fail('rpc_error');
      if (!body?.result) return fail('invalid_response');
      if (body.result.isError === true) return fail('tool_error');
      return Math.max(0, Math.round(performance.now() - startedAt));
    } catch (error) {
      // Keep HTTP failures recognizable even when their consumed body is not JSON.
      if (httpOk === false) return fail('http_error');
      // Names select fixed categories; no exception message/name/cause is emitted.
      const name = error instanceof Error ? error.name : undefined;
      if (name === 'TimeoutError' ||
        (name === 'AbortError' && signal?.aborted && signal.reason?.name === 'TimeoutError')) {
        return fail('timeout');
      }
      if (name === 'AbortError') return fail('aborted');
      if (phase === 'response_body' && name === 'SyntaxError') return fail('invalid_json');
      return fail('transport_error');
    }
  };

  // Exclude one bounded warm-up from the steady-state p95. Burst/concurrency is
  // covered separately by the 60-operation soak and the 16-way dedupe gate.
  const warmupMs = await executeSample(0);
  await runConcurrent(
    Array.from({ length: samples }, (_, index) => index + 1),
    concurrency,
    async (sample) => {
      const durationMs = await executeSample(sample);
      if (durationMs !== null) durations.push(durationMs);
    },
  );

  const p95Ms = percentile95(durations);
  const failed = failures.length;
  const ok =
    failed === 0 &&
    durations.length === samples &&
    p95Ms <= HYBRID_P95_THRESHOLD_MS;
  return {
    warmupMs,
    samples: durations.length,
    failed,
    p95Ms,
    thresholdMs: HYBRID_P95_THRESHOLD_MS,
    ok,
    failures: failures.sort((left, right) => left.sampleIndex - right.sampleIndex),
  };
}

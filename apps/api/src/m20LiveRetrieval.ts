const LIVE_READ_ONLY_SAMPLES = 12;
const HYBRID_P95_THRESHOLD_MS = 2_000;

type LiveRetrievalClient = {
  request(
    input: string | URL | Request,
    init?: RequestInit | undefined,
  ): Promise<Response>;
};

export type M20LiveRetrievalReport = {
  samples: number;
  failed: number;
  p95Ms: number;
  thresholdMs: number;
  ok: boolean;
};

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
  const concurrency = input.concurrency ?? 3;
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
  let failed = 0;
  await runConcurrent(
    Array.from({ length: samples }, (_, index) => index + 1),
    concurrency,
    async (sample) => {
      const startedAt = performance.now();
      try {
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
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = (await response.json()) as {
          error?: unknown;
          result?: { isError?: boolean };
        };
        if (!response.ok || body.error || !body.result || body.result.isError === true) {
          failed += 1;
          return;
        }
        durations.push(Math.max(0, Math.round(performance.now() - startedAt)));
      } catch {
        failed += 1;
      }
    },
  );

  const p95Ms = percentile95(durations);
  const ok =
    failed === 0 &&
    durations.length === samples &&
    p95Ms <= HYBRID_P95_THRESHOLD_MS;
  return {
    samples: durations.length,
    failed,
    p95Ms,
    thresholdMs: HYBRID_P95_THRESHOLD_MS,
    ok,
  };
}

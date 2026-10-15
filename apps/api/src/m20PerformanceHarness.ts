import { OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK } from '@memory-os/schemas';
import {
  runBoundedSoakRecipe,
  resolveBoundedSoakConfig,
  type BoundedSoakConfigInput,
  type BoundedSoakReport,
} from './soakHarness.js';

export const OFFICIAL_M20_PERFORMANCE_SOAK_VERSION = 'm20-s03-v1' as const;

const DEFAULT_WAVES = 5;
const MAX_WAVES = 5;
const ROUNDS_PER_WAVE = 2;
const CONCURRENCY_PER_WAVE = 3;

type PerformanceClient = {
  request(
    input: string | URL | Request,
    init?: RequestInit | undefined,
  ): Promise<Response>;
};

type LatencyTargetId =
  | 'search.hybrid'
  | 'search.agentic'
  | 'project.state'
  | 'write.receipt';

type AgenticLatencySample = {
  ok: boolean;
  durationMs: number;
};

export type M20PerformanceSoakReport = {
  version: typeof OFFICIAL_M20_PERFORMANCE_SOAK_VERSION;
  config: {
    projectId: string;
    waves: number;
    roundsPerWave: number;
    concurrencyPerWave: number;
  };
  totalOperations: number;
  apiFailures: number;
  mcpFailures: number;
  targets: Record<LatencyTargetId, { samples: number; p95Ms: number }>;
  assertions: { ok: boolean; errors: string[] };
};

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ??
    Number.POSITIVE_INFINITY;
}

function resolveWaves(value: number | null | undefined): number {
  const waves = value ?? DEFAULT_WAVES;
  if (!Number.isInteger(waves) || waves <= 0 || waves > MAX_WAVES) {
    throw new Error(`M20 performance waves must be an integer from 1 to ${MAX_WAVES}`);
  }
  return waves;
}

export function evaluateM20PerformanceSoak(
  report: Omit<M20PerformanceSoakReport, 'assertions'>,
): string[] {
  const errors: string[] = [];
  const thresholds = OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK.thresholds;
  if (report.totalOperations < thresholds.soakOperationsFloor) {
    errors.push(
      `soak operation floor missed (${report.totalOperations} < ${thresholds.soakOperationsFloor})`,
    );
  }
  if (report.apiFailures > 0) errors.push(`api failures observed: ${report.apiFailures}`);
  if (report.mcpFailures > 0) errors.push(`mcp failures observed: ${report.mcpFailures}`);
  if (report.targets['search.hybrid'].p95Ms > thresholds.hybridP95Ms) {
    errors.push(
      `search.hybrid p95 exceeded (${report.targets['search.hybrid'].p95Ms}ms > ${thresholds.hybridP95Ms}ms)`,
    );
  }
  if (report.targets['search.agentic'].samples === 0) {
    errors.push('search.agentic recorded no successful samples');
  } else if (report.targets['search.agentic'].p95Ms > thresholds.agenticP95Ms) {
    errors.push(
      `search.agentic p95 exceeded (${report.targets['search.agentic'].p95Ms}ms > ${thresholds.agenticP95Ms}ms)`,
    );
  }
  return errors;
}

async function runAgenticLatencySample(
  client: PerformanceClient,
  input: BoundedSoakConfigInput,
  sample: number,
): Promise<AgenticLatencySample> {
  const config = resolveBoundedSoakConfig(input);
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });
  if (config.apiSecret) headers.set('x-memory-os-api-secret', config.apiSecret);
  const startedAt = performance.now();
  try {
    const response = await client.request(`${config.baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20_000 + sample,
        method: 'tools/call',
        params: {
          name: 'memory.search',
          arguments: {
            query: 'M20 bounded agentic performance gate',
            project_id: config.projectId,
            retrieval_mode: 'agentic',
            agentic: {
              max_steps: 2,
              max_time_ms: 7_000,
              max_tokens: 2_000,
              max_cost_usd: 0.01,
              min_evidence_hits: 1,
            },
            pack_context: false,
          },
        },
      }),
      signal: AbortSignal.timeout(
        OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK.thresholds.agenticP95Ms + 1_000,
      ),
    });
    const body = (await response.json()) as {
      error?: unknown;
      result?: { isError?: boolean };
    };
    return {
      ok:
        response.ok &&
        !body.error &&
        Boolean(body.result) &&
        body.result?.isError !== true,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  } catch {
    return {
      ok: false,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  }
}

export async function runM20PerformanceSoak(
  client: PerformanceClient,
  input: BoundedSoakConfigInput & { waves?: number | null },
): Promise<M20PerformanceSoakReport> {
  const waves = resolveWaves(input.waves);
  const reports: BoundedSoakReport[] = [];
  const agenticSamples: AgenticLatencySample[] = [];
  for (let wave = 1; wave <= waves; wave += 1) {
    const report = await runBoundedSoakRecipe(client, {
      ...input,
      waves: undefined,
      rounds: ROUNDS_PER_WAVE,
      concurrency: CONCURRENCY_PER_WAVE,
      idempotencyNamespace: `${input.idempotencyNamespace ?? 'm20-s03-performance'}/wave-${wave}`,
    } as BoundedSoakConfigInput);
    if (!report.assertions.ok) {
      throw new Error(`M20 performance wave ${wave} failed: ${report.assertions.errors.join('; ')}`);
    }
    reports.push(report);
    agenticSamples.push(await runAgenticLatencySample(client, input, wave));
  }

  const burst = reports.flatMap((report) => report.burst);
  const target = (targetId: LatencyTargetId) => {
    if (targetId === 'search.agentic') {
      const durations = agenticSamples.filter((row) => row.ok).map((row) => row.durationMs);
      return { samples: durations.length, p95Ms: percentile95(durations) };
    }
    const durations = burst
      .filter((row) => row.ok && row.targetId === targetId)
      .map((row) => row.durationMs);
    return { samples: durations.length, p95Ms: percentile95(durations) };
  };
  const base: Omit<M20PerformanceSoakReport, 'assertions'> = {
    version: OFFICIAL_M20_PERFORMANCE_SOAK_VERSION,
    config: {
      projectId: String(input.projectId ?? ''),
      waves,
      roundsPerWave: ROUNDS_PER_WAVE,
      concurrencyPerWave: CONCURRENCY_PER_WAVE,
    },
    totalOperations: burst.length + agenticSamples.length,
    apiFailures: burst.filter((row) => row.surface === 'api' && !row.ok).length,
    mcpFailures:
      burst.filter((row) => row.surface === 'mcp' && !row.ok).length +
      agenticSamples.filter((row) => !row.ok).length,
    targets: {
      'search.hybrid': target('search.hybrid'),
      'search.agentic': target('search.agentic'),
      'project.state': target('project.state'),
      'write.receipt': target('write.receipt'),
    },
  };
  const errors = evaluateM20PerformanceSoak(base);
  return {
    ...base,
    assertions: { ok: errors.length === 0, errors },
  };
}

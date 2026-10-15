import { OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK } from '@memory-os/schemas';
import {
  runBoundedSoakRecipe,
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

type LatencyTargetId = 'search.hybrid' | 'project.state' | 'write.receipt';

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
  return errors;
}

export async function runM20PerformanceSoak(
  client: PerformanceClient,
  input: BoundedSoakConfigInput & { waves?: number | null },
): Promise<M20PerformanceSoakReport> {
  const waves = resolveWaves(input.waves);
  const reports: BoundedSoakReport[] = [];
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
  }

  const burst = reports.flatMap((report) => report.burst);
  const target = (targetId: LatencyTargetId) => {
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
    totalOperations: burst.length,
    apiFailures: burst.filter((row) => row.surface === 'api' && !row.ok).length,
    mcpFailures: burst.filter((row) => row.surface === 'mcp' && !row.ok).length,
    targets: {
      'search.hybrid': target('search.hybrid'),
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

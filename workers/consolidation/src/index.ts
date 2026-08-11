import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import type { MemoryStore } from '@memory-os/domain';
import {
  planCandidateConsolidations,
  type ConsolidationPair,
} from '@memory-os/retrieval';

export const packageName = 'worker-consolidation' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const OWNER_ID =
  process.env.MEMORY_OS_OWNER_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333301';

export type ConsolidationReport = {
  scanned: number;
  planned: number;
  applied: ConsolidationPair[];
  failed: Array<{ pair: ConsolidationPair; error: string }>;
};

function requireGateway(
  gateway?: SupabaseMemoryGateway,
): SupabaseMemoryGateway {
  if (gateway) return gateway;
  const env = loadMemoryOsEnv();
  if (!env) {
    throw new Error(
      'Missing MEMORY_OS_SUPABASE_URL / ANON_KEY / API_SECRET for consolidation',
    );
  }
  return new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret);
}

/** Local/memory-store consolidation path (no Supabase). */
export async function consolidateLocalStore(
  store: MemoryStore,
  options?: {
    actorSubjectId?: string;
    similarityThreshold?: number;
    apply?: boolean;
  },
): Promise<ConsolidationReport> {
  const actorSubjectId = options?.actorSubjectId ?? OWNER_ID;
  const candidates = [...store.memories.values()]
    .filter((m) => m.status === 'candidate')
    .map((m) => ({
      id: m.id,
      title: m.title,
      content: m.content,
      status: m.status,
      recordedAt: m.recordedAt,
    }));
  const planned = await planCandidateConsolidations(candidates, {
    similarityThreshold: options?.similarityThreshold,
  });
  const applied: ConsolidationPair[] = [];
  const failed: ConsolidationReport['failed'] = [];
  if (options?.apply === false) {
    return { scanned: candidates.length, planned: planned.length, applied, failed };
  }
  for (const pair of planned) {
    try {
      store.supersedeMemory({
        duplicateId: pair.duplicateId,
        keeperId: pair.keeperId,
        reason: `consolidation: ${pair.reason}`,
        actorSubjectId,
      });
      applied.push(pair);
    } catch (err) {
      failed.push({
        pair,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    scanned: candidates.length,
    planned: planned.length,
    applied,
    failed,
  };
}

/** Remote consolidation over candidate memories. */
export async function planConsolidation(options?: {
  workspaceId?: string;
  subjectId?: string;
  gateway?: SupabaseMemoryGateway;
  similarityThreshold?: number;
  apply?: boolean;
  limit?: number;
}): Promise<ConsolidationReport> {
  const gateway = requireGateway(options?.gateway);
  const subjectId = options?.subjectId ?? OWNER_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const rows = await gateway.listMemories({
    subjectId,
    workspaceId,
    status: 'candidate',
    limit: options?.limit ?? 100,
  });
  const planned = await planCandidateConsolidations(
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      status: row.status,
      recordedAt: row.recordedAt,
      embedding: Array.isArray(row.embedding) ? row.embedding : null,
    })),
    { similarityThreshold: options?.similarityThreshold },
  );

  const applied: ConsolidationPair[] = [];
  const failed: ConsolidationReport['failed'] = [];
  if (options?.apply === false) {
    return { scanned: rows.length, planned: planned.length, applied, failed };
  }

  for (const pair of planned) {
    try {
      await gateway.supersedeMemory({
        subjectId,
        duplicateId: pair.duplicateId,
        keeperId: pair.keeperId,
        reason: `consolidation: ${pair.reason}`,
      });
      applied.push(pair);
    } catch (err) {
      failed.push({
        pair,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    scanned: rows.length,
    planned: planned.length,
    applied,
    failed,
  };
}

export type ConsolidationTickReport = ConsolidationReport & {
  jobId: string | null;
  eventId: string | null;
  jobStatus: string | null;
  pendingOutbox: number;
  deadLettered: number;
};

/** Enqueue outbox job → consolidate → complete (cron / CLI tick). */
export async function runConsolidationTick(options?: {
  workspaceId?: string;
  subjectId?: string;
  gateway?: SupabaseMemoryGateway;
  similarityThreshold?: number;
  apply?: boolean;
  limit?: number;
  staleMinutes?: number;
}): Promise<ConsolidationTickReport> {
  const gateway = requireGateway(options?.gateway);
  const subjectId = options?.subjectId ?? OWNER_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const stale = await gateway.deadLetterStaleJobs({
    subjectId,
    workspaceId,
    olderThanMinutes:
      options?.staleMinutes ??
      Number(process.env.MEMORY_OS_JOB_STALE_MINUTES ?? 60),
  });
  const pending = await gateway.listOutboxPending({
    subjectId,
    workspaceId,
    eventType: 'memory.consolidation.requested',
    limit: 20,
  });
  const enqueued = await gateway.enqueueConsolidation({ subjectId, workspaceId });
  try {
    const report = await planConsolidation({
      ...options,
      gateway,
      subjectId,
      workspaceId,
    });
    const status =
      report.failed.length > 0 && report.applied.length === 0
        ? 'failed'
        : 'succeeded';
    const completed = await gateway.completeConsolidation({
      subjectId,
      jobId: enqueued.jobId,
      status,
      error:
        status === 'failed'
          ? report.failed.map((f) => f.error).join('; ').slice(0, 500)
          : null,
    });
    return {
      ...report,
      jobId: enqueued.jobId,
      eventId: enqueued.eventId,
      jobStatus: completed.status,
      pendingOutbox: pending.count,
      deadLettered: stale.deadLettered,
    };
  } catch (err) {
    await gateway.completeConsolidation({
      subjectId,
      jobId: enqueued.jobId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function runConsolidationOnce(): Promise<ConsolidationTickReport> {
  return runConsolidationTick();
}

export function parseWorkerIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.MEMORY_OS_WORKER_INTERVAL_MS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) {
    throw new Error('MEMORY_OS_WORKER_INTERVAL_MS must be >= 1000');
  }
  return n;
}

export async function startConsolidationLoop(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const intervalMs = parseWorkerIntervalMs(env);
  const tick = async () => {
    const report = await runConsolidationTick();
    console.log(JSON.stringify({ ok: true, ...report }));
  };
  await tick();
  if (intervalMs == null) return;
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'loop',
      intervalMs,
      worker: 'consolidation',
    }),
  );
  setInterval(() => {
    void tick().catch((err: Error) => {
      console.error(err.message);
    });
  }, intervalMs);
}

const isDirectRun = process.argv[1]?.includes('consolidation');
if (isDirectRun) {
  void startConsolidationLoop()
    .then(() => {
      if (!parseWorkerIntervalMs()) process.exit(0);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}

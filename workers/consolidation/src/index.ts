import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import type { MemoryStore } from '@memory-os/domain';
import {
  planCandidateConsolidations,
  planProactiveConsolidation,
  buildProactiveConsolidationReason,
  type ConsolidationPair,
  type ProactiveConsolidationConflict,
  type ProactiveConsolidationStopReason,
  PROACTIVE_CONSOLIDATION_RULES_VERSION,
} from '@memory-os/retrieval';
import { randomUUID } from 'node:crypto';

export const packageName = 'worker-consolidation' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const OWNER_ID =
  process.env.MEMORY_OS_OWNER_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333301';
const PROACTIVE_PROJECT_ERROR =
  'project_id is required for proactive consolidation; never default to AISTROYKA';

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

export type ProactiveConsolidationReport = {
  runId: string;
  projectId: string;
  rulesVersion: string;
  scanned: number;
  planned: number;
  mergeCandidatesTotal: number;
  candidateConflicts: ProactiveConsolidationConflict[];
  candidateConflictsTotal: number;
  applied: ConsolidationPair[];
  failed: Array<{ pair: ConsolidationPair; error: string }>;
  stopReason: ProactiveConsolidationStopReason;
  exhausted: boolean;
  verifiedWrites: 0;
  jobId: string | null;
  eventId: string | null;
  jobStatus: string | null;
  auditEventId: string | null;
  backend: 'memory-store' | 'supabase';
};

type AuditAppender = (input: {
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}) => Promise<{ id: string }>;

function requireExplicitProjectId(projectId?: string | null): string {
  const explicitProjectId = projectId?.trim();
  if (!explicitProjectId) {
    throw new Error(PROACTIVE_PROJECT_ERROR);
  }
  return explicitProjectId;
}

function createGatewayAuditAppender(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
): AuditAppender {
  return async (input) =>
    gateway.appendAuditEvent({
      subjectId,
      workspaceId,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      reason: input.reason,
      beforeState: input.beforeState,
      afterState: input.afterState,
    });
}

function createStoreAuditAppender(
  store: MemoryStore,
  subjectId: string,
  workspaceId: string,
): AuditAppender {
  return async (input) =>
    Promise.resolve(
      store.createAuditEvent({
        workspaceId,
        actorSubjectId: subjectId,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        reason: input.reason,
        beforeState: input.beforeState,
        afterState: input.afterState,
      }),
    );
}

async function runPlannedProactiveConsolidation(input: {
  workspaceId: string;
  subjectId: string;
  projectId: string;
  candidates: Array<{
    id: string;
    title: string;
    content: string;
    status: string;
    recordedAt?: string;
    embedding?: number[] | null;
    projectId?: string | null;
  }>;
  apply?: boolean;
  similarityThreshold?: number;
  scanLimit?: number;
  maxMerges?: number;
  maxConflicts?: number;
  maxTimeMs?: number;
  enqueue?: boolean;
  enqueueJob?: () => Promise<{
    jobId: string;
    eventId: string;
    idempotencyKey: string;
  } | null>;
  completeJob?: (input: {
    jobId: string;
    status: 'succeeded' | 'failed';
    error?: string | null;
  }) => Promise<{ status: string } | null>;
  audit: AuditAppender;
  supersede: (input: {
    duplicateId: string;
    keeperId: string;
    reason: string;
  }) => Promise<void>;
  backend: 'memory-store' | 'supabase';
}): Promise<ProactiveConsolidationReport> {
  const apply = input.apply !== false;
  const runId = randomUUID();
  const jobMeta = input.enqueue ? await input.enqueueJob?.() : null;
  const plan = await planProactiveConsolidation(input.candidates, {
    similarityThreshold: input.similarityThreshold,
    scanLimit: input.scanLimit,
    maxMerges: input.maxMerges,
    maxConflicts: input.maxConflicts,
    maxTimeMs: input.maxTimeMs,
  });

  const applied: ConsolidationPair[] = [];
  const failed: Array<{ pair: ConsolidationPair; error: string }> = [];

  if (apply) {
    for (const pair of plan.mergeCandidates) {
      const reason = buildProactiveConsolidationReason({
        runId,
        pairReason: pair.reason,
      });
      try {
        await input.supersede({
          duplicateId: pair.duplicateId,
          keeperId: pair.keeperId,
          reason,
        });
        applied.push(pair);
        await input.audit({
          action: 'consolidation.proactive.applied',
          objectType: 'memory',
          objectId: pair.duplicateId,
          reason,
          afterState: {
            runId,
            rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
            projectId: input.projectId,
            duplicateId: pair.duplicateId,
            keeperId: pair.keeperId,
            score: pair.score,
            pairReason: pair.reason,
            inputMemoryIds: [pair.duplicateId, pair.keeperId],
          },
        });
      } catch (err) {
        failed.push({
          pair,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const jobStatus =
    failed.length > 0 && applied.length === 0 ? 'failed' : 'succeeded';
  const completedJob = jobMeta
    ? await input.completeJob?.({
        jobId: jobMeta.jobId,
        status: jobStatus,
        error:
          jobStatus === 'failed'
            ? failed.map((entry) => entry.error).join('; ').slice(0, 500)
            : null,
      })
    : null;

  const auditEvent = await input.audit({
    action: apply
      ? 'consolidation.proactive.completed'
      : 'consolidation.proactive.planned',
    objectType: 'consolidation_run',
    objectId: runId,
    reason: 'project-scoped proactive consolidation',
    afterState: {
      runId,
      projectId: input.projectId,
      rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
      jobId: jobMeta?.jobId ?? null,
      eventId: jobMeta?.eventId ?? null,
      backend: input.backend,
      apply,
      scanned: plan.scanned,
      inputMemoryIds: plan.inputMemoryIds,
      mergeCandidatesTotal: plan.mergeCandidatesTotal,
      mergeCandidates: plan.mergeCandidates,
      candidateConflictsTotal: plan.candidateConflictsTotal,
      candidateConflicts: plan.candidateConflicts,
      appliedPairs: applied,
      failedPairs: failed,
      stopReason: plan.stopReason,
      exhausted: plan.exhausted,
      verifiedWrites: plan.verifiedWrites,
    },
  });

  return {
    runId,
    projectId: input.projectId,
    rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
    scanned: plan.scanned,
    planned: plan.mergeCandidates.length,
    mergeCandidatesTotal: plan.mergeCandidatesTotal,
    candidateConflicts: plan.candidateConflicts,
    candidateConflictsTotal: plan.candidateConflictsTotal,
    applied,
    failed,
    stopReason: plan.stopReason,
    exhausted: plan.exhausted,
    verifiedWrites: 0,
    jobId: jobMeta?.jobId ?? null,
    eventId: jobMeta?.eventId ?? null,
    jobStatus: completedJob?.status ?? null,
    auditEventId: auditEvent.id,
    backend: input.backend,
  };
}

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

export async function runProactiveConsolidationTick(options: {
  projectId: string;
  workspaceId?: string;
  subjectId: string;
  gateway?: SupabaseMemoryGateway;
  apply?: boolean;
  scanLimit?: number;
  maxMerges?: number;
  maxConflicts?: number;
  maxTimeMs?: number;
  similarityThreshold?: number;
  enqueue?: boolean;
  reason?: string | null;
}): Promise<ProactiveConsolidationReport> {
  const projectId = requireExplicitProjectId(options.projectId);
  const workspaceId = options.workspaceId ?? WORKSPACE_ID;
  const subjectId = options.subjectId;
  const gateway = requireGateway(options.gateway);
  const rows = await gateway.listMemories({
    subjectId,
    workspaceId,
    projectId,
    limit: options.scanLimit ?? 100,
  });
  return runPlannedProactiveConsolidation({
    workspaceId,
    subjectId,
    projectId,
    candidates: rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      status: row.status,
      recordedAt: row.recordedAt,
      embedding: Array.isArray(row.embedding) ? row.embedding : null,
      projectId: row.projectId,
    })),
    apply: options.apply,
    similarityThreshold: options.similarityThreshold,
    scanLimit: options.scanLimit,
    maxMerges: options.maxMerges,
    maxConflicts: options.maxConflicts,
    maxTimeMs: options.maxTimeMs,
    enqueue: options.enqueue,
    enqueueJob: async () =>
      gateway.enqueueConsolidation({
        subjectId,
        workspaceId,
        projectId,
        proactive: true,
        reason: options.reason ?? null,
      }),
    completeJob: async ({ jobId, status, error }) =>
      gateway.completeConsolidation({
        subjectId,
        jobId,
        status,
        error: error ?? null,
      }),
    audit: createGatewayAuditAppender(gateway, subjectId, workspaceId),
    supersede: async ({ duplicateId, keeperId, reason }) => {
      await gateway.supersedeMemory({
        subjectId,
        duplicateId,
        keeperId,
        reason,
      });
    },
    backend: 'supabase',
  });
}

export async function runProactiveConsolidationLocalStore(input: {
  store: MemoryStore;
  workspaceId: string;
  subjectId: string;
  projectId: string;
  apply?: boolean;
  scanLimit?: number;
  maxMerges?: number;
  maxConflicts?: number;
  maxTimeMs?: number;
  similarityThreshold?: number;
}): Promise<ProactiveConsolidationReport> {
  const projectId = requireExplicitProjectId(input.projectId);
  const candidates = [...input.store.memories.values()]
    .filter((memory) => memory.workspaceId === input.workspaceId)
    .filter((memory) => memory.projectId === projectId)
    .map((memory) => ({
      id: memory.id,
      title: memory.title,
      content: memory.content,
      status: memory.status,
      recordedAt: memory.recordedAt,
      projectId: memory.projectId,
    }));
  return runPlannedProactiveConsolidation({
    workspaceId: input.workspaceId,
    subjectId: input.subjectId,
    projectId,
    candidates,
    apply: input.apply,
    similarityThreshold: input.similarityThreshold,
    scanLimit: input.scanLimit,
    maxMerges: input.maxMerges,
    maxConflicts: input.maxConflicts,
    maxTimeMs: input.maxTimeMs,
    enqueue: false,
    audit: createStoreAuditAppender(input.store, input.subjectId, input.workspaceId),
    supersede: async ({ duplicateId, keeperId, reason }) => {
      input.store.supersedeMemory({
        duplicateId,
        keeperId,
        reason,
        actorSubjectId: input.subjectId,
      });
    },
    backend: 'memory-store',
  });
}

export function parseProactiveConsolidationEnv(
  env: NodeJS.ProcessEnv = process.env,
): { projectId: string; subjectId: string } | null {
  const projectId = env.MEMORY_OS_CONSOLIDATION_PROJECT_ID?.trim();
  if (!projectId) return null;
  const subjectId = env.MEMORY_OS_CONSOLIDATION_SUBJECT_ID?.trim();
  if (!subjectId) {
    throw new Error(
      'MEMORY_OS_CONSOLIDATION_SUBJECT_ID is required when MEMORY_OS_CONSOLIDATION_PROJECT_ID is set',
    );
  }
  return { projectId, subjectId };
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
  const proactive = parseProactiveConsolidationEnv(env);
  const tick = async () => {
    const report = proactive
      ? await runProactiveConsolidationTick({
          projectId: proactive.projectId,
          subjectId: proactive.subjectId,
          workspaceId: WORKSPACE_ID,
          enqueue: true,
          apply: true,
        })
      : await runConsolidationTick();
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

import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';

export const packageName = 'worker-roma-project-health' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const ROMA_SUBJECT_ID =
  process.env.MEMORY_OS_ROMA_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333304';
const DEFAULT_REASON =
  'Generate an audited ROMA project-health summary for one explicit project.';

type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  url?: string | null;
};

type ContextMemory = {
  title: string;
};

type ProjectStateRow = {
  version?: number;
  summary?: string | null;
  state?: Record<string, unknown> | null;
};

type HandoffRow = {
  createdAt?: string;
  fromSubjectId?: string | null;
  toSubjectId?: string | null;
  payload?: Record<string, unknown> | null;
};

type ProjectContextRow = {
  projectId: string;
  decisions: ContextMemory[];
  tasks: ContextMemory[];
  facts: ContextMemory[];
  state?: ProjectStateRow | null;
  latestHandoff?: HandoffRow | null;
};

export type ClaimedRomaProjectHealthJob = {
  jobId: string;
  workspaceId: string;
  status: string;
  attempt: number;
  error: string | null;
  idempotencyKey: string;
  requestEventId: string;
  projectId: string;
  requestedBy: string | null;
  reason: string | null;
};

type RomaProjectHealthGateway = Pick<
  SupabaseMemoryGateway,
  | 'appendAuditEvent'
  | 'captureConnectorRecord'
  | 'claimRomaProjectHealthJobs'
  | 'completeRomaProjectHealth'
  | 'deadLetterStaleJobs'
  | 'listOutboxPending'
  | 'listProjects'
  | 'projectContext'
>;

export type RomaProjectHealthRunResult = {
  jobId: string;
  projectId: string;
  memoryId: string;
  auditEventId: string;
  summaryTitle: string;
  projectName: string;
};

export type RomaProjectHealthTickReport = {
  claimed: number;
  completed: RomaProjectHealthRunResult[];
  failed: Array<{ jobId: string; projectId: string; error: string }>;
  pendingOutbox: number;
  deadLettered: number;
};

type SummaryPayload = {
  title: string;
  text: string;
  quoteTitles: {
    decisions: string[];
    tasks: string[];
    facts: string[];
  };
  counts: {
    decisions: number;
    tasks: number;
    facts: number;
    stateVersion: number | null;
    hasHandoff: boolean;
  };
};

function requireGateway(
  gateway?: RomaProjectHealthGateway,
): RomaProjectHealthGateway {
  if (gateway) return gateway;
  const env = loadMemoryOsEnv();
  if (!env) {
    throw new Error(
      'Missing MEMORY_OS_SUPABASE_URL / ANON_KEY / API_SECRET for ROMA project health',
    );
  }
  return new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret);
}

function truncateText(value: string, max = 160): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function takeTitles(items: ContextMemory[], limit = 5): string[] {
  return items
    .map((item) => truncateText(item.title, 120))
    .filter((title) => title.length > 0)
    .slice(0, limit);
}

function summarizeHandoff(handoff: HandoffRow | null | undefined): string {
  if (!handoff) return 'No handoff recorded.';
  const payload = handoff.payload ?? {};
  const candidates = [
    typeof payload.summary === 'string' ? payload.summary : null,
    typeof payload.title === 'string' ? payload.title : null,
    typeof payload.note === 'string' ? payload.note : null,
    typeof payload.reason === 'string' ? payload.reason : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => truncateText(value, 180));
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  const createdAt = handoff.createdAt ? ` at ${handoff.createdAt}` : '';
  return `Handoff recorded${createdAt}.`;
}

function formatList(label: string, values: string[]): string {
  if (values.length === 0) return `- ${label}: none`;
  return `- ${label}: ${values.join('; ')}`;
}

export function buildRomaProjectHealthSummary(input: {
  project: ProjectRow;
  context: ProjectContextRow;
  job: ClaimedRomaProjectHealthJob;
  romaSubjectId?: string;
}): SummaryPayload {
  const romaSubjectId = input.romaSubjectId ?? ROMA_SUBJECT_ID;
  const state = input.context.state ?? null;
  const stateData =
    state && typeof state.state === 'object' && state.state !== null ? state.state : {};
  const completed = readStringArray(stateData.completed);
  const inProgress = readStringArray(stateData.in_progress);
  const blocked = readStringArray(stateData.blocked);
  const next = readStringArray(stateData.next);
  const risks = readStringArray(stateData.risks);
  const decisionTitles = takeTitles(input.context.decisions);
  const taskTitles = takeTitles(input.context.tasks);
  const factTitles = takeTitles(input.context.facts);
  const stage =
    typeof stateData.stage === 'string' && stateData.stage.trim().length > 0
      ? stateData.stage.trim()
      : 'unknown';
  const stateSummary =
    typeof state?.summary === 'string' && state.summary.trim().length > 0
      ? truncateText(state.summary, 220)
      : 'No project state summary recorded.';
  const handoffSummary = summarizeHandoff(input.context.latestHandoff);
  const requestedBy = input.job.requestedBy ?? 'unknown';
  const reason = input.job.reason ?? DEFAULT_REASON;

  const lines = [
    'ROMA project health summary',
    `Project: ${input.project.name} (${input.project.slug})`,
    `Project status: ${input.project.status}`,
    `Project ID: ${input.project.id}`,
    `Execution subject: ROMA (${romaSubjectId})`,
    `Requested by: ${requestedBy}`,
    `Reason: ${reason}`,
    'Bounded scope: one explicit project, one summary, ACL-filtered internal-or-lower memories only.',
    '',
    'Snapshot',
    `- State summary: ${stateSummary}`,
    `- State stage: ${stage}`,
    `- Decisions visible to ROMA: ${input.context.decisions.length}`,
    `- Tasks visible to ROMA: ${input.context.tasks.length}`,
    `- Facts visible to ROMA: ${input.context.facts.length}`,
    `- Latest handoff present: ${input.context.latestHandoff ? 'yes' : 'no'}`,
    '',
    'Progress',
    formatList('Completed', completed),
    formatList('In progress', inProgress),
    formatList('Blocked', blocked),
    formatList('Next', next),
    formatList('Risks', risks),
    '',
    'Headlines',
    formatList('Decision titles', decisionTitles),
    formatList('Task titles', taskTitles),
    formatList('Fact titles', factTitles),
    `- Latest handoff: ${handoffSummary}`,
    '',
    'Audit',
    `- Job ID: ${input.job.jobId}`,
    `- Request event ID: ${input.job.requestEventId}`,
    `- Idempotency key: ${input.job.idempotencyKey}`,
    '- Note: titles and structured state only; raw memory bodies are not quoted in this summary.',
    '- ACL note: personal, confidential, and restricted memories remain excluded from ROMA access.',
  ];

  return {
    title: `ROMA project health: ${input.project.name}`,
    text: lines.join('\n'),
    quoteTitles: {
      decisions: decisionTitles,
      tasks: taskTitles,
      facts: factTitles,
    },
    counts: {
      decisions: input.context.decisions.length,
      tasks: input.context.tasks.length,
      facts: input.context.facts.length,
      stateVersion: typeof state?.version === 'number' ? state.version : null,
      hasHandoff: Boolean(input.context.latestHandoff),
    },
  };
}

export async function runRomaProjectHealthJob(options: {
  gateway?: RomaProjectHealthGateway;
  job: ClaimedRomaProjectHealthJob;
  romaSubjectId?: string;
}): Promise<RomaProjectHealthRunResult> {
  const gateway = requireGateway(options.gateway);
  const romaSubjectId = options.romaSubjectId ?? ROMA_SUBJECT_ID;
  const job = options.job;

  try {
    const projects = await gateway.listProjects(romaSubjectId, job.workspaceId);
    const project = projects.find((entry) => entry.id === job.projectId);
    if (!project) {
      throw new Error(`project ${job.projectId} is not visible to ROMA`);
    }

    const context = (await gateway.projectContext(
      romaSubjectId,
      job.projectId,
    )) as ProjectContextRow;
    const summary = buildRomaProjectHealthSummary({
      project,
      context,
      job,
      romaSubjectId,
    });
    const capture = await gateway.captureConnectorRecord({
      subjectId: romaSubjectId,
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      provider: 'roma',
      accountId: 'service:roma',
      externalId: `project-health/${job.projectId}`,
      externalVersion: '1',
      eventType: 'roma.project_health.created',
      title: summary.title,
      text: summary.text,
      idempotencyKey: job.idempotencyKey,
      sensitivity: 'internal',
      storageMode: 'indexed',
      observedAt: new Date().toISOString(),
      filename: `roma-project-health-${job.projectId}.md`,
      mimeType: 'text/markdown',
      canonicalReference: `memory-os://roma/project-health/${job.projectId}`,
      provenance: {
        automation: {
          jobType: 'roma_project_health',
          jobId: job.jobId,
          requestEventId: job.requestEventId,
          requestedBy: job.requestedBy,
          executionSubjectId: romaSubjectId,
          idempotencyKey: job.idempotencyKey,
        },
        scope: {
          workspaceId: job.workspaceId,
          projectId: job.projectId,
        },
        reason: job.reason ?? DEFAULT_REASON,
      },
      metadata: {
        summary_type: 'project_health',
        project_slug: project.slug,
        project_name: project.name,
        project_status: project.status,
        source_counts: summary.counts,
      },
      processNow: true,
    });
    const memoryId = capture.process?.memoryId;
    if (!memoryId) {
      throw new Error('roma project health capture did not produce a memory');
    }
    const audit = await gateway.appendAuditEvent({
      subjectId: romaSubjectId,
      workspaceId: job.workspaceId,
      action: 'roma.project_health.written',
      objectType: 'memory',
      objectId: memoryId,
      reason: job.reason ?? DEFAULT_REASON,
      afterState: {
        projectId: job.projectId,
        jobId: job.jobId,
        requestEventId: job.requestEventId,
        requestedBy: job.requestedBy,
        executionSubjectId: romaSubjectId,
        memoryId,
        sourceEventId: capture.eventId ?? null,
        summaryTitle: summary.title,
        quoteTitles: summary.quoteTitles,
        sourceCounts: summary.counts,
      },
    });
    await gateway.completeRomaProjectHealth({
      subjectId: romaSubjectId,
      jobId: job.jobId,
      status: 'succeeded',
      memoryId,
      auditEventId: audit.id,
    });

    return {
      jobId: job.jobId,
      projectId: job.projectId,
      memoryId,
      auditEventId: audit.id,
      summaryTitle: summary.title,
      projectName: project.name,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await gateway.completeRomaProjectHealth({
        subjectId: romaSubjectId,
        jobId: job.jobId,
        status: 'failed',
        error: message,
      });
    } catch {
      // Preserve the original failure while making a best effort to mark the job.
    }
    throw err;
  }
}

export async function runRomaProjectHealthTick(options?: {
  gateway?: RomaProjectHealthGateway;
  workspaceId?: string;
  projectId?: string | null;
  limit?: number;
  staleMinutes?: number;
  romaSubjectId?: string;
}): Promise<RomaProjectHealthTickReport> {
  const gateway = requireGateway(options?.gateway);
  const romaSubjectId = options?.romaSubjectId ?? ROMA_SUBJECT_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const stale = await gateway.deadLetterStaleJobs({
    subjectId: romaSubjectId,
    workspaceId,
    olderThanMinutes:
      options?.staleMinutes ??
      Number(process.env.MEMORY_OS_JOB_STALE_MINUTES ?? 60),
  });
  const pending = await gateway.listOutboxPending({
    subjectId: romaSubjectId,
    workspaceId,
    eventType: 'roma.project_health.requested',
    limit: 20,
  });
  const claimed = await gateway.claimRomaProjectHealthJobs({
    subjectId: romaSubjectId,
    workspaceId,
    limit: options?.limit ?? 10,
    projectId: options?.projectId ?? null,
  });
  const completed: RomaProjectHealthRunResult[] = [];
  const failed: RomaProjectHealthTickReport['failed'] = [];

  for (const job of claimed.jobs) {
    try {
      completed.push(
        await runRomaProjectHealthJob({
          gateway,
          job,
          romaSubjectId,
        }),
      );
    } catch (err) {
      failed.push({
        jobId: job.jobId,
        projectId: job.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    claimed: claimed.count,
    completed,
    failed,
    pendingOutbox: pending.count,
    deadLettered: stale.deadLettered,
  };
}

export async function runRomaProjectHealthOnce(): Promise<RomaProjectHealthTickReport> {
  return runRomaProjectHealthTick();
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

export async function startRomaProjectHealthLoop(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const intervalMs = parseWorkerIntervalMs(env);
  const tick = async () => {
    const report = await runRomaProjectHealthTick();
    console.log(JSON.stringify({ ok: true, ...report }));
  };
  await tick();
  if (intervalMs == null) return;
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'loop',
      intervalMs,
      worker: 'roma-project-health',
    }),
  );
  setInterval(() => {
    void tick().catch((err: Error) => {
      console.error(err.message);
    });
  }, intervalMs);
}

const isDirectRun = process.argv[1]?.includes('roma-project-health');
if (isDirectRun) {
  void startRomaProjectHealthLoop()
    .then(() => {
      if (!parseWorkerIntervalMs()) process.exit(0);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}

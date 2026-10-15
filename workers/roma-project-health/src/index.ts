import { createHash } from 'node:crypto';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import {
  buildProjectContextPack,
  OFFICIAL_M18_ROMA_INTEGRATION_PACK,
  type ProjectContextPack,
} from '@memory-os/schemas';

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
  id?: string;
  title: string;
  content?: string | null;
  memoryType?: string | null;
  memory_type?: string | null;
  sensitivity?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ProjectStateRow = {
  version?: number;
  summary?: string | null;
  state?: Record<string, unknown> | null;
};

type HandoffRow = {
  id?: string;
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

export type ClaimedRomaProjectFindingsJob = {
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
  | 'claimRomaProjectFindingsJobs'
  | 'claimRomaProjectHealthJobs'
  | 'completeRomaProjectFindings'
  | 'completeRomaProjectHealth'
  | 'deadLetterStaleJobs'
  | 'getMemory'
  | 'listOutboxPending'
  | 'listProjects'
  | 'projectContext'
  | 'retryRomaProjectFindings'
  | 'retryRomaProjectHealth'
  | 'tickRomaProjectHealthSchedules'
>;

export type RomaProjectHealthRunResult = {
  jobId: string;
  projectId: string;
  memoryId: string;
  auditEventId: string;
  summaryTitle: string;
  projectName: string;
  notificationIds: string[];
  notificationEventIds: string[];
  notificationAuditEventIds: string[];
  notificationInsertedCount: number;
  notificationSeverity: 'info';
};

type FindingSeverity = 'low' | 'medium' | 'high';
type FindingStatus = 'open';
type NotificationSeverity = 'info' | 'low' | 'medium' | 'high';
type FindingOutcomeType = 'qa' | 'release_risk';
type FindingCanonicalStatus = 'candidate';
type ReleaseReferenceType = 'pull_request' | 'commit' | 'deployment';

type QaFindingEvidenceRef = {
  kind: 'memory' | 'project_state' | 'handoff' | 'release';
  memoryId?: string;
  memoryType?: string | null;
  handoffId?: string | null;
  stateVersion?: number | null;
  field?: string;
  title?: string;
  titles?: string[];
  createdAt?: string | null;
  releaseType?: ReleaseReferenceType;
  value?: string;
  url?: string | null;
  citationIds?: string[];
};

type QaFindingCandidate = {
  key: string;
  title: string;
  summary: string;
  severity: FindingSeverity;
  status: FindingStatus;
  outcomeType: FindingOutcomeType;
  confidence: number;
  canonicalStatus: FindingCanonicalStatus;
  requiresReview: true;
  evidenceRefs: QaFindingEvidenceRef[];
};

type RomaQaFindingWrite = {
  findingKey: string;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
  outcomeType: FindingOutcomeType;
  confidence: number;
  canonicalStatus: FindingCanonicalStatus;
  requiresReview: true;
  memoryId: string;
  auditEventId: string;
  idempotencyKey: string;
};

export type RomaQaFindingApprovalCheckpointRequest = {
  title: string;
  summary: string;
  findingKey: string;
  severity: FindingSeverity;
  findingStatus: FindingStatus;
  outcomeType: FindingOutcomeType;
  confidence: number;
  canonicalStatus: FindingCanonicalStatus;
  requiresReview: true;
  reason: string;
  evidenceRefs: QaFindingEvidenceRef[];
  sourceJobId: string;
  requestEventId: string;
  idempotencyKey: string;
};

export type RomaProjectFindingsRunResult = {
  jobId: string;
  projectId: string;
  projectName: string;
  findingCount: number;
  findings: RomaQaFindingWrite[];
  notificationIds: string[];
  notificationEventIds: string[];
  notificationAuditEventIds: string[];
  notificationInsertedCount: number;
  notificationSeverity: FindingSeverity;
};

export type RomaProjectHealthTickReport = {
  scheduled: {
    count: number;
    enqueued: Array<{
      scheduleId: string;
      projectId: string;
      periodStart: string;
      nextRunAt: string;
      jobId: string;
      inserted: boolean;
      skippedIntervals: number;
      idempotencyKey: string;
    }>;
    disabled: Array<{ scheduleId: string; projectId: string; error: string }>;
    errors: Array<{ scheduleId: string; projectId: string; error: string }>;
  };
  claimed: number;
  completed: RomaProjectHealthRunResult[];
  failed: Array<{ jobId: string; projectId: string; error: string }>;
  pendingOutbox: number;
  deadLettered: number;
  error: string | null;
};

export type RomaProjectFindingsTickReport = {
  claimed: number;
  completed: RomaProjectFindingsRunResult[];
  failed: Array<{ jobId: string; projectId: string; error: string }>;
  pendingOutbox: number;
  deadLettered: number;
  error: string | null;
};

export type RomaAutomationTickReport = {
  qaFindings: RomaProjectFindingsTickReport;
  projectHealth: RomaProjectHealthTickReport;
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
  contextPack: ProjectContextPack;
  releaseRefs: QaFindingEvidenceRef[];
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

function toMemoryEvidenceRefs(
  items: ContextMemory[],
  limit = 3,
): QaFindingEvidenceRef[] {
  return items
    .filter((item) => typeof item.id === 'string' && item.id.length > 0)
    .slice(0, limit)
    .map((item) => ({
      kind: 'memory' as const,
      memoryId: item.id,
      memoryType: item.memoryType ?? item.memory_type ?? null,
      title: truncateText(item.title, 120),
    }));
}

function findingPolicy(outcomeType: FindingOutcomeType) {
  return {
    outcomeType,
    confidence: OFFICIAL_M18_ROMA_INTEGRATION_PACK.findingPolicy.defaultConfidence,
    canonicalStatus:
      OFFICIAL_M18_ROMA_INTEGRATION_PACK.findingPolicy.canonicalStatus,
    requiresReview: true as const,
  };
}

function buildRomaProjectContextPack(
  context: ProjectContextRow,
  projectId: string,
): ProjectContextPack {
  const pack = buildProjectContextPack(context, { projectId });
  if (
    pack.projectId !== projectId ||
    pack.provenance.explicitProject !== true ||
    pack.provenance.subjectScoped !== true
  ) {
    throw new Error('ROMA project context pack failed explicit-project provenance checks');
  }
  return pack;
}

function releaseEvidenceRefs(pack: ProjectContextPack): QaFindingEvidenceRef[] {
  const refs: QaFindingEvidenceRef[] = [];
  for (const merge of pack.recentMerges) {
    if (merge.pullRequestUrl) {
      refs.push({
        kind: 'release',
        releaseType: 'pull_request',
        value: merge.pullRequestUrl,
        url: merge.pullRequestUrl,
        title: truncateText(merge.title, 120),
        citationIds: [...merge.citations],
      });
    }
    if (merge.mergeSha) {
      refs.push({
        kind: 'release',
        releaseType: 'commit',
        value: merge.mergeSha,
        url: null,
        title: truncateText(merge.title, 120),
        citationIds: [...merge.citations],
      });
    }
  }
  const milestone = pack.currentMilestone;
  if (
    milestone &&
    /\b(?:deploy(?:ed|ment)?|live|prod(?:uction)?|release|edge|migration)\b/i.test(
      `${milestone.title} ${milestone.summary}`,
    )
  ) {
    refs.push({
      kind: 'release',
      releaseType: 'deployment',
      value: milestone.id,
      url: `memory-os://memory/${milestone.id}`,
      title: truncateText(milestone.title, 120),
      citationIds: [...milestone.citations],
    });
  }
  const seen = new Set<string>();
  return refs
    .filter((ref) => {
      const key = `${ref.releaseType ?? ''}:${ref.value ?? ''}`;
      if (!ref.value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function projectContextItemEvidenceRefs(
  pack: ProjectContextPack,
  items: ProjectContextPack['activeBlockers'],
  field: string,
): QaFindingEvidenceRef[] {
  const citationById = new Map(pack.citations.map((citation) => [citation.id, citation]));
  const refs: QaFindingEvidenceRef[] = [];
  for (const item of items.slice(0, 3)) {
    for (const citationId of item.citations) {
      const citation = citationById.get(citationId);
      if (!citation) continue;
      if (citation.kind === 'memory') {
        refs.push({
          kind: 'memory',
          memoryId: citation.sourceId,
          title: citation.title ?? undefined,
          field,
        });
      } else if (citation.kind === 'handoff') {
        refs.push({
          kind: 'handoff',
          handoffId: citation.sourceId,
          createdAt: citation.recordedAt,
          field,
        });
      } else {
        refs.push({
          kind: 'project_state',
          field,
          titles: [truncateText(item.text, 120)],
        });
      }
    }
  }
  return refs;
}

function safeProjectContextItemText(
  pack: ProjectContextPack,
  item: ProjectContextPack['activeBlockers'][number],
): string {
  const citationById = new Map(pack.citations.map((citation) => [citation.id, citation]));
  const memoryCitations = item.citations
    .map((citationId) => citationById.get(citationId))
    .filter((citation) => citation?.kind === 'memory');
  if (memoryCitations.length > 0) {
    const titles = memoryCitations
      .map((citation) => citation?.title)
      .filter((title): title is string => Boolean(title))
      .map((title) => truncateText(title, 160));
    return titles.length > 0 ? titles.join('; ') : 'memory evidence recorded';
  }
  return truncateText(item.text, 180);
}

function safeProjectContextItemTexts(
  pack: ProjectContextPack,
  items: ProjectContextPack['activeBlockers'],
): string[] {
  return items.map((item) => safeProjectContextItemText(pack, item));
}

function formatQaFindingEvidenceRef(ref: QaFindingEvidenceRef): string {
  switch (ref.kind) {
    case 'memory':
      return `- memory ${ref.memoryType ?? 'memory'} ${ref.memoryId}: ${ref.title ?? 'Untitled'}`;
    case 'project_state':
      return `- project_state v${ref.stateVersion ?? 'n/a'} ${ref.field ?? 'context'}: ${(ref.titles ?? []).join('; ') || 'none'}`;
    case 'handoff':
      return `- handoff ${ref.handoffId ?? 'none'}${ref.createdAt ? ` at ${ref.createdAt}` : ''}`;
    case 'release':
      return `- release ${ref.releaseType ?? 'evidence'} ${ref.value ?? 'unknown'}${ref.url ? ` (${ref.url})` : ''}`;
    default: {
      const _exhaustive: never = ref.kind;
      return _exhaustive;
    }
  }
}

function stableFindingIdempotencyKey(input: {
  projectId: string;
  findingKey: string;
  severity: FindingSeverity;
  status: FindingStatus;
  outcomeType: FindingOutcomeType;
  confidence: number;
  canonicalStatus: FindingCanonicalStatus;
  requiresReview: true;
  evidenceRefs: QaFindingEvidenceRef[];
}): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 24);
  return `roma-project-findings/${input.projectId}/${input.findingKey}/${fingerprint}`;
}

function findingRevision(idempotencyKey: string): string {
  const revision = idempotencyKey.split('/').at(-1)?.trim();
  if (!revision) throw new Error('ROMA finding idempotency revision is missing');
  return revision;
}

function maxFindingSeverity(findings: RomaQaFindingWrite[]): FindingSeverity {
  let severity: FindingSeverity = 'low';
  for (const finding of findings) {
    switch (finding.severity) {
      case 'high':
        return 'high';
      case 'medium':
        severity = 'medium';
        break;
      case 'low':
        break;
      default: {
        const _exhaustive: never = finding.severity;
        return _exhaustive;
      }
    }
  }
  return severity;
}

function buildHealthNotification(input: {
  result: Pick<RomaProjectHealthRunResult, 'jobId' | 'projectId' | 'projectName' | 'memoryId' | 'summaryTitle'>;
}): {
  title: string;
  severity: Extract<NotificationSeverity, 'info'>;
  sourceMemoryIds: string[];
  metadata: Record<string, unknown>;
} {
  return {
    title: `ROMA project health updated: ${input.result.projectName}`,
    severity: 'info',
    sourceMemoryIds: [input.result.memoryId],
    metadata: {
      projectId: input.result.projectId,
      sourceJobId: input.result.jobId,
      summaryTitle: input.result.summaryTitle,
    },
  };
}

function buildFindingsNotification(input: {
  result: Pick<RomaProjectFindingsRunResult, 'jobId' | 'projectId' | 'projectName' | 'findingCount' | 'findings'>;
}): {
  title: string;
  severity: FindingSeverity;
  sourceMemoryIds: string[];
  metadata: Record<string, unknown>;
} {
  return {
    title: `ROMA QA findings: ${input.result.projectName} (${input.result.findingCount} open)`,
    severity: maxFindingSeverity(input.result.findings),
    sourceMemoryIds: input.result.findings.map((finding) => finding.memoryId),
    metadata: {
      projectId: input.result.projectId,
      sourceJobId: input.result.jobId,
      findingCount: input.result.findingCount,
      findingKeys: input.result.findings.map((finding) => finding.findingKey),
    },
  };
}

function assertStructuredWriteSuccess<T extends { error?: unknown }>(result: T): T {
  if (typeof result.error === 'string' && result.error.trim().length > 0) {
    throw new Error(result.error);
  }
  return result;
}

async function verifyRomaCandidateWrite(input: {
  gateway: RomaProjectHealthGateway;
  romaSubjectId: string;
  projectId: string;
  memoryId: string;
}): Promise<void> {
  const memory = await input.gateway.getMemory({
    subjectId: input.romaSubjectId,
    memoryId: input.memoryId,
  });
  if (
    memory.projectId !== input.projectId ||
    memory.status !== OFFICIAL_M18_ROMA_INTEGRATION_PACK.findingPolicy.canonicalStatus ||
    memory.createdBySubject !== input.romaSubjectId
  ) {
    throw new Error(
      'ROMA write verification failed: memory must remain a project-scoped candidate authored by ROMA',
    );
  }
}

function isRetryableRomaProjectHealthError(message: string): boolean {
  return !/project .* not visible to ROMA|project not found/i.test(message);
}

function isRetryableRomaProjectFindingsError(message: string): boolean {
  return !/project .* not visible to ROMA|project not found/i.test(message);
}

export function buildRomaProjectHealthSummary(input: {
  project: ProjectRow;
  context: ProjectContextRow;
  contextPack?: ProjectContextPack;
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
  const contextPack =
    input.contextPack ?? buildRomaProjectContextPack(input.context, input.project.id);
  const releaseRefs = releaseEvidenceRefs(contextPack);
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
    'Shared project context',
    `- Context pack: ${contextPack.packVersion}`,
    `- Current goal: ${contextPack.currentGoal ? safeProjectContextItemText(contextPack, contextPack.currentGoal) : 'none'}`,
    `- Current milestone: ${contextPack.currentMilestone?.title ?? 'none'}`,
    formatList(
      'Active blockers',
      safeProjectContextItemTexts(contextPack, contextPack.activeBlockers),
    ),
    formatList(
      'Unresolved conflicts',
      safeProjectContextItemTexts(contextPack, contextPack.unresolvedConflicts),
    ),
    formatList('Next work', safeProjectContextItemTexts(contextPack, contextPack.nextWork)),
    `- Source freshness: ${contextPack.sourceFreshness.status}`,
    `- Release evidence refs: ${releaseRefs.length}`,
    `- Budget: ${contextPack.budget.estimatedTokens}/${contextPack.budget.maxTokens} estimated tokens`,
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
    contextPack,
    releaseRefs,
  };
}

function buildRomaQaFindingCandidates(input: {
  project: ProjectRow;
  context: ProjectContextRow;
  contextPack: ProjectContextPack;
}): QaFindingCandidate[] {
  const state = input.context.state ?? null;
  const stateData =
    state && typeof state.state === 'object' && state.state !== null ? state.state : {};
  const blockedFromState = readStringArray(stateData.blocked);
  const blocked =
    blockedFromState.length > 0
      ? blockedFromState
      : input.contextPack.activeBlockers.map((item) => item.text);
  const risksFromState = readStringArray(stateData.risks);
  const risks =
    risksFromState.length > 0
      ? risksFromState
      : input.contextPack.unresolvedConflicts.map((item) => item.text);
  const next = readStringArray(stateData.next);
  const taskRefs = toMemoryEvidenceRefs(input.context.tasks);
  const factRefs = toMemoryEvidenceRefs(input.context.facts);
  const blockerContextRefs = projectContextItemEvidenceRefs(
    input.contextPack,
    input.contextPack.activeBlockers,
    'activeBlockers',
  );
  const conflictContextRefs = projectContextItemEvidenceRefs(
    input.contextPack,
    input.contextPack.unresolvedConflicts,
    'unresolvedConflicts',
  );
  const releaseRefs = releaseEvidenceRefs(input.contextPack);
  const candidates: QaFindingCandidate[] = [];

  if (blocked.length > 0) {
    candidates.push({
      key: 'blocked-work',
      title: 'Blocked work requires review',
      summary:
        'Project state lists blocked work items, so ROMA flagged follow-up that may stall delivery.',
      severity: blocked.length > 1 ? 'high' : 'medium',
      status: 'open',
      ...findingPolicy('release_risk'),
      evidenceRefs: [
        {
          kind: 'project_state',
          stateVersion: typeof state?.version === 'number' ? state.version : null,
          field: 'blocked',
          titles: blocked.slice(0, 5).map((entry) => truncateText(entry, 120)),
        },
        ...taskRefs,
        ...blockerContextRefs,
        ...releaseRefs,
      ],
    });
  }

  if (risks.length > 0) {
    candidates.push({
      key: 'active-risks',
      title: 'Explicit project risks need QA follow-up',
      summary:
        'The project state includes active risks that should stay visible until the owner confirms mitigation.',
      severity: 'medium',
      status: 'open',
      ...findingPolicy('release_risk'),
      evidenceRefs: [
        {
          kind: 'project_state',
          stateVersion: typeof state?.version === 'number' ? state.version : null,
          field: 'risks',
          titles: risks.slice(0, 5).map((entry) => truncateText(entry, 120)),
        },
        ...factRefs,
        ...conflictContextRefs,
        ...releaseRefs,
      ],
    });
  }

  if (!input.context.latestHandoff) {
    candidates.push({
      key: 'missing-handoff',
      title: 'Recent handoff is missing',
      summary:
        'ROMA could not find a recent handoff for this project, reducing traceability for the next automation step.',
      severity: 'medium',
      status: 'open',
      ...findingPolicy('qa'),
      evidenceRefs: [
        {
          kind: 'handoff',
          handoffId: null,
          createdAt: null,
        },
        ...taskRefs,
      ],
    });
  }

  const stateSummary =
    typeof state?.summary === 'string' ? state.summary.trim() : '';
  if (stateSummary.length === 0) {
    candidates.push({
      key: 'missing-project-state-summary',
      title: 'Project state summary is missing',
      summary:
        'ROMA could not find a current project state summary, so QA context is harder to audit or explain.',
      severity: 'medium',
      status: 'open',
      ...findingPolicy('qa'),
      evidenceRefs: [
        {
          kind: 'project_state',
          stateVersion: typeof state?.version === 'number' ? state.version : null,
          field: 'summary',
          titles: [],
        },
      ],
    });
  }

  if (input.context.tasks.length === 0) {
    candidates.push({
      key: 'missing-current-tasks',
      title: 'Current task memory is missing',
      summary:
        'ROMA did not find any active or verified task memories for the project, which weakens QA accountability.',
      severity: 'medium',
      status: 'open',
      ...findingPolicy('qa'),
      evidenceRefs: [
        {
          kind: 'project_state',
          stateVersion: typeof state?.version === 'number' ? state.version : null,
          field: 'next',
          titles: next.slice(0, 5).map((entry) => truncateText(entry, 120)),
        },
      ],
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      key: 'missing-explicit-risks',
      title: 'Explicit risk register is missing',
      summary:
        'ROMA found no explicit blocked or risk entries in the current project state, so follow-up remains under-documented.',
      severity: 'low',
      status: 'open',
      ...findingPolicy('qa'),
      evidenceRefs: [
        {
          kind: 'project_state',
          stateVersion: typeof state?.version === 'number' ? state.version : null,
          field: 'risks',
          titles: [],
        },
      ],
    });
  }

  if (
    input.contextPack.sourceFreshness.status === 'stale' &&
    candidates.length < 3
  ) {
    candidates.push({
      key: 'stale-release-context',
      title: 'Release context is stale',
      summary:
        'ROMA detected project context older than the configured freshness SLA, so release conclusions require refreshed evidence.',
      severity: 'high',
      status: 'open',
      ...findingPolicy('release_risk'),
      evidenceRefs: releaseRefs,
    });
  }

  return candidates.slice(0, 3);
}

function buildRomaQaFindingMemory(input: {
  project: ProjectRow;
  job: ClaimedRomaProjectFindingsJob;
  finding: QaFindingCandidate;
  romaSubjectId?: string;
}) {
  const romaSubjectId = input.romaSubjectId ?? ROMA_SUBJECT_ID;
  const reason =
    input.job.reason ?? 'Generate audited ROMA QA findings for one explicit project.';
  const idempotencyKey = stableFindingIdempotencyKey({
    projectId: input.job.projectId,
    findingKey: input.finding.key,
    severity: input.finding.severity,
    status: input.finding.status,
    outcomeType: input.finding.outcomeType,
    confidence: input.finding.confidence,
    canonicalStatus: input.finding.canonicalStatus,
    requiresReview: input.finding.requiresReview,
    evidenceRefs: input.finding.evidenceRefs,
  });
  const lines = [
    'ROMA QA finding',
    `Project: ${input.project.name} (${input.project.slug})`,
    `Project status: ${input.project.status}`,
    `Project ID: ${input.project.id}`,
    `Finding key: ${input.finding.key}`,
    `Severity: ${input.finding.severity}`,
    `Status: ${input.finding.status}`,
    `Outcome type: ${input.finding.outcomeType}`,
    `Confidence: ${input.finding.confidence}`,
    `Canonical status: ${input.finding.canonicalStatus}`,
    `Requires review: ${input.finding.requiresReview ? 'yes' : 'no'}`,
    `Execution subject: ROMA (${romaSubjectId})`,
    `Requested by: ${input.job.requestedBy ?? 'unknown'}`,
    `Reason: ${reason}`,
    'Bounded scope: one explicit project, one finding memory, source IDs/titles only.',
    '',
    `Summary: ${input.finding.summary}`,
    '',
    'Evidence refs',
    ...input.finding.evidenceRefs.map(formatQaFindingEvidenceRef),
    '',
    'Audit',
    `- Job ID: ${input.job.jobId}`,
    `- Request event ID: ${input.job.requestEventId}`,
    `- Idempotency key: ${idempotencyKey}`,
    '- Note: this finding stores titles and structured evidence refs only; raw memory bodies are not quoted.',
    '- Promotion policy: ROMA findings remain candidate evidence and cannot silently become verified canonical truth.',
    '- ACL note: personal, confidential, and restricted memories remain excluded from ROMA access.',
  ];

  return {
    idempotencyKey,
    title: `ROMA QA finding: ${input.finding.title}`,
    text: lines.join('\n'),
  };
}

export function buildRomaQaFindingApprovalCheckpointRequest(input: {
  job: ClaimedRomaProjectFindingsJob;
  finding: QaFindingCandidate;
}): RomaQaFindingApprovalCheckpointRequest {
  const reason =
    input.job.reason ?? 'Generate audited ROMA QA findings for one explicit project.';
  const idempotencyKey = stableFindingIdempotencyKey({
    projectId: input.job.projectId,
    findingKey: input.finding.key,
    severity: input.finding.severity,
    status: input.finding.status,
    outcomeType: input.finding.outcomeType,
    confidence: input.finding.confidence,
    canonicalStatus: input.finding.canonicalStatus,
    requiresReview: input.finding.requiresReview,
    evidenceRefs: input.finding.evidenceRefs,
  });

  return {
    title: `ROMA QA finding: ${input.finding.title}`,
    summary: input.finding.summary,
    findingKey: input.finding.key,
    severity: input.finding.severity,
    findingStatus: input.finding.status,
    outcomeType: input.finding.outcomeType,
    confidence: input.finding.confidence,
    canonicalStatus: input.finding.canonicalStatus,
    requiresReview: input.finding.requiresReview,
    reason,
    evidenceRefs: input.finding.evidenceRefs.map((ref) => ({
      kind: ref.kind,
      memoryId: ref.memoryId,
      memoryType: ref.memoryType,
      handoffId: ref.handoffId,
      stateVersion: ref.stateVersion ?? null,
      field: ref.field,
      title: ref.title,
      titles: ref.titles ? [...ref.titles] : undefined,
      createdAt: ref.createdAt ?? null,
      releaseType: ref.releaseType,
      value: ref.value,
      url: ref.url ?? null,
      citationIds: ref.citationIds ? [...ref.citationIds] : undefined,
    })),
    sourceJobId: input.job.jobId,
    requestEventId: input.job.requestEventId,
    idempotencyKey,
  };
}

async function executeRomaProjectHealthJob(options: {
  gateway?: RomaProjectHealthGateway;
  job: ClaimedRomaProjectHealthJob;
  romaSubjectId?: string;
}): Promise<RomaProjectHealthRunResult> {
  const gateway = requireGateway(options.gateway);
  const romaSubjectId = options.romaSubjectId ?? ROMA_SUBJECT_ID;
  const job = options.job;

  const projects = await gateway.listProjects(romaSubjectId, job.workspaceId);
  const project = projects.find((entry) => entry.id === job.projectId);
  if (!project) {
    throw new Error(`project ${job.projectId} is not visible to ROMA`);
  }

  const context = (await gateway.projectContext(
    romaSubjectId,
    job.projectId,
  )) as ProjectContextRow;
  const contextPack = buildRomaProjectContextPack(context, job.projectId);
  const summary = buildRomaProjectHealthSummary({
    project,
    context,
    contextPack,
    job,
    romaSubjectId,
  });
  const capture = assertStructuredWriteSuccess(await gateway.captureConnectorRecord({
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
        integrationPackVersion: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
        projectContextPackVersion: contextPack.packVersion,
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
      roma_integration_pack: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
      project_context_pack: contextPack.packVersion,
      project_context_generated_at: contextPack.generatedAt,
      project_context_freshness: contextPack.sourceFreshness.status,
      project_context_citations: contextPack.citations.map((citation) => citation.id),
      release_refs: summary.releaseRefs,
    },
    processNow: true,
  }));
  const memoryId = capture.process?.memoryId;
  if (!memoryId) {
    throw new Error('roma project health capture did not produce a memory');
  }
  await verifyRomaCandidateWrite({
    gateway,
    romaSubjectId,
    projectId: job.projectId,
    memoryId,
  });
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
      integrationPackVersion: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
      projectContextPackVersion: contextPack.packVersion,
      projectContextGeneratedAt: contextPack.generatedAt,
      projectContextFreshness: contextPack.sourceFreshness.status,
      releaseRefs: summary.releaseRefs,
    },
  });

  return {
    jobId: job.jobId,
    projectId: job.projectId,
    memoryId,
    auditEventId: audit.id,
    summaryTitle: summary.title,
    projectName: project.name,
    notificationIds: [],
    notificationEventIds: [],
    notificationAuditEventIds: [],
    notificationInsertedCount: 0,
    notificationSeverity: 'info',
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
    const result = await executeRomaProjectHealthJob({
      gateway,
      job,
      romaSubjectId,
    });
    const notification = buildHealthNotification({ result });
    const completion = await gateway.completeRomaProjectHealth({
      subjectId: romaSubjectId,
      jobId: job.jobId,
      status: 'succeeded',
      memoryId: result.memoryId,
      auditEventId: result.auditEventId,
      notificationTitle: notification.title,
      notificationSeverity: notification.severity,
      notificationSourceMemoryIds: notification.sourceMemoryIds,
      notificationMetadata: notification.metadata,
    });
    return {
      ...result,
      notificationIds: completion.notificationIds ?? [],
      notificationEventIds: completion.notificationEventIds ?? [],
      notificationAuditEventIds: completion.notificationAuditEventIds ?? [],
      notificationInsertedCount: completion.notificationInsertedCount ?? 0,
      notificationSeverity: notification.severity,
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

async function executeRomaProjectFindingsJob(options: {
  gateway?: RomaProjectHealthGateway;
  job: ClaimedRomaProjectFindingsJob;
  romaSubjectId?: string;
}): Promise<RomaProjectFindingsRunResult> {
  const gateway = requireGateway(options.gateway);
  const romaSubjectId = options.romaSubjectId ?? ROMA_SUBJECT_ID;
  const job = options.job;

  const projects = await gateway.listProjects(romaSubjectId, job.workspaceId);
  const project = projects.find((entry) => entry.id === job.projectId);
  if (!project) {
    throw new Error(`project ${job.projectId} is not visible to ROMA`);
  }

  const context = (await gateway.projectContext(
    romaSubjectId,
    job.projectId,
  )) as ProjectContextRow;
  const contextPack = buildRomaProjectContextPack(context, job.projectId);
  const candidates = buildRomaQaFindingCandidates({
    project,
    context,
    contextPack,
  });
  const findings: RomaQaFindingWrite[] = [];

  for (const candidate of candidates) {
    const findingMemory = buildRomaQaFindingMemory({
      project,
      job,
      finding: candidate,
      romaSubjectId,
    });
    const capture = assertStructuredWriteSuccess(await gateway.captureConnectorRecord({
      subjectId: romaSubjectId,
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      provider: 'roma',
      accountId: 'service:roma',
      externalId: `qa-finding/${job.projectId}/${candidate.key}`,
      externalVersion: findingRevision(findingMemory.idempotencyKey),
      eventType: 'roma.qa_finding.created',
      title: findingMemory.title,
      text: findingMemory.text,
      idempotencyKey: findingMemory.idempotencyKey,
      sensitivity: 'internal',
      storageMode: 'indexed',
      observedAt: new Date().toISOString(),
      filename: `roma-qa-finding-${job.projectId}-${candidate.key}.md`,
      mimeType: 'text/markdown',
      canonicalReference: `memory-os://roma/qa-findings/${job.projectId}/${candidate.key}`,
      provenance: {
        automation: {
          jobType: 'roma_project_findings',
          jobId: job.jobId,
          requestEventId: job.requestEventId,
          requestedBy: job.requestedBy,
          executionSubjectId: romaSubjectId,
          idempotencyKey: findingMemory.idempotencyKey,
          integrationPackVersion: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
          projectContextPackVersion: contextPack.packVersion,
        },
        scope: {
          workspaceId: job.workspaceId,
          projectId: job.projectId,
        },
        reason:
          job.reason ?? 'Generate audited ROMA QA findings for one explicit project.',
      },
      metadata: {
        summary_type: 'qa_finding',
        project_slug: project.slug,
        project_name: project.name,
        project_status: project.status,
        finding_key: candidate.key,
        finding_severity: candidate.severity,
        finding_status: candidate.status,
        outcome_type: candidate.outcomeType,
        confidence: candidate.confidence,
        canonical_status: candidate.canonicalStatus,
        requires_review: candidate.requiresReview,
        auto_verify_allowed: false,
        evidence_refs: candidate.evidenceRefs,
        release_refs: candidate.evidenceRefs.filter(
          (ref) => ref.kind === 'release',
        ),
        roma_integration_pack: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
        project_context_pack: contextPack.packVersion,
        project_context_generated_at: contextPack.generatedAt,
        project_context_freshness: contextPack.sourceFreshness.status,
      },
      processNow: true,
    }));
    const memoryId = capture.process?.memoryId;
    if (!memoryId) {
      throw new Error(`roma qa finding capture did not produce a memory for ${candidate.key}`);
    }
    await verifyRomaCandidateWrite({
      gateway,
      romaSubjectId,
      projectId: job.projectId,
      memoryId,
    });
    const audit = await gateway.appendAuditEvent({
      subjectId: romaSubjectId,
      workspaceId: job.workspaceId,
      action: 'roma.qa_finding.written',
      objectType: 'memory',
      objectId: memoryId,
      reason: job.reason ?? 'Generate audited ROMA QA findings for one explicit project.',
      afterState: {
        projectId: job.projectId,
        jobId: job.jobId,
        requestEventId: job.requestEventId,
        requestedBy: job.requestedBy,
        executionSubjectId: romaSubjectId,
        memoryId,
        sourceEventId: capture.eventId ?? null,
        findingKey: candidate.key,
        findingTitle: findingMemory.title,
        severity: candidate.severity,
        status: candidate.status,
        outcomeType: candidate.outcomeType,
        confidence: candidate.confidence,
        canonicalStatus: candidate.canonicalStatus,
        requiresReview: candidate.requiresReview,
        autoVerifyAllowed: false,
        integrationPackVersion: OFFICIAL_M18_ROMA_INTEGRATION_PACK.version,
        projectContextPackVersion: contextPack.packVersion,
        projectContextGeneratedAt: contextPack.generatedAt,
        evidenceRefs: candidate.evidenceRefs,
      },
    });
    findings.push({
      findingKey: candidate.key,
      title: findingMemory.title,
      severity: candidate.severity,
      status: candidate.status,
      outcomeType: candidate.outcomeType,
      confidence: candidate.confidence,
      canonicalStatus: candidate.canonicalStatus,
      requiresReview: candidate.requiresReview,
      memoryId,
      auditEventId: audit.id,
      idempotencyKey: findingMemory.idempotencyKey,
    });
  }

  return {
    jobId: job.jobId,
    projectId: job.projectId,
    projectName: project.name,
    findingCount: findings.length,
    findings,
    notificationIds: [],
    notificationEventIds: [],
    notificationAuditEventIds: [],
    notificationInsertedCount: 0,
    notificationSeverity: maxFindingSeverity(findings),
  };
}

export async function runRomaProjectFindingsJob(options: {
  gateway?: RomaProjectHealthGateway;
  job: ClaimedRomaProjectFindingsJob;
  romaSubjectId?: string;
}): Promise<RomaProjectFindingsRunResult> {
  const gateway = requireGateway(options.gateway);
  const romaSubjectId = options.romaSubjectId ?? ROMA_SUBJECT_ID;
  const job = options.job;

  try {
    const result = await executeRomaProjectFindingsJob({
      gateway,
      job,
      romaSubjectId,
    });
    const notification = buildFindingsNotification({ result });
    const completion = await gateway.completeRomaProjectFindings({
      subjectId: romaSubjectId,
      jobId: job.jobId,
      status: 'succeeded',
      memoryId: result.findings[0]?.memoryId ?? null,
      auditEventId: result.findings[0]?.auditEventId ?? null,
      findingCount: result.findingCount,
      notificationTitle: notification.title,
      notificationSeverity: notification.severity,
      notificationSourceMemoryIds: notification.sourceMemoryIds,
      notificationMetadata: notification.metadata,
    });
    return {
      ...result,
      notificationIds: completion.notificationIds ?? [],
      notificationEventIds: completion.notificationEventIds ?? [],
      notificationAuditEventIds: completion.notificationAuditEventIds ?? [],
      notificationInsertedCount: completion.notificationInsertedCount ?? 0,
      notificationSeverity: notification.severity,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await gateway.completeRomaProjectFindings({
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

export async function runRomaProjectFindingsTick(options?: {
  gateway?: RomaProjectHealthGateway;
  workspaceId?: string;
  projectId?: string | null;
  limit?: number;
  staleMinutes?: number;
  romaSubjectId?: string;
}): Promise<RomaProjectFindingsTickReport> {
  const gateway = requireGateway(options?.gateway);
  const romaSubjectId = options?.romaSubjectId ?? ROMA_SUBJECT_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const maxAttempts = Math.max(
    1,
    Number(process.env.MEMORY_OS_ROMA_PROJECT_FINDINGS_MAX_ATTEMPTS ?? 3),
  );
  const stale = await gateway.deadLetterStaleJobs({
    subjectId: romaSubjectId,
    workspaceId,
    olderThanMinutes:
      options?.staleMinutes ??
      Number(process.env.MEMORY_OS_JOB_STALE_MINUTES ?? 60),
  });
  const claimed = await gateway.claimRomaProjectFindingsJobs({
    subjectId: romaSubjectId,
    workspaceId,
    limit: options?.limit ?? 10,
    projectId: options?.projectId ?? null,
  });
  const completed: RomaProjectFindingsRunResult[] = [];
  const failed: RomaProjectFindingsTickReport['failed'] = [];

  for (const job of claimed.jobs) {
    try {
      const result = await executeRomaProjectFindingsJob({
        gateway,
        job,
        romaSubjectId,
      });
      const notification = buildFindingsNotification({ result });
      const completion = await gateway.completeRomaProjectFindings({
        subjectId: romaSubjectId,
        jobId: job.jobId,
        status: 'succeeded',
        memoryId: result.findings[0]?.memoryId ?? null,
        auditEventId: result.findings[0]?.auditEventId ?? null,
        findingCount: result.findingCount,
        notificationTitle: notification.title,
        notificationSeverity: notification.severity,
        notificationSourceMemoryIds: notification.sourceMemoryIds,
        notificationMetadata: notification.metadata,
      });
      completed.push({
        ...result,
        notificationIds: completion.notificationIds ?? [],
        notificationEventIds: completion.notificationEventIds ?? [],
        notificationAuditEventIds: completion.notificationAuditEventIds ?? [],
        notificationInsertedCount: completion.notificationInsertedCount ?? 0,
        notificationSeverity: notification.severity,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isRetryableRomaProjectFindingsError(message)) {
        if (job.attempt + 1 >= maxAttempts) {
          await gateway.completeRomaProjectFindings({
            subjectId: romaSubjectId,
            jobId: job.jobId,
            status: 'dead_letter',
            error: message,
          });
        } else {
          await gateway.retryRomaProjectFindings({
            subjectId: romaSubjectId,
            jobId: job.jobId,
            error: message,
          });
        }
      } else {
        await gateway.completeRomaProjectFindings({
          subjectId: romaSubjectId,
          jobId: job.jobId,
          status: 'failed',
          error: message,
        });
      }
      failed.push({
        jobId: job.jobId,
        projectId: job.projectId,
        error: message,
      });
    }
  }

  const pending = await gateway.listOutboxPending({
    subjectId: romaSubjectId,
    workspaceId,
    eventType: 'roma.project_findings.requested',
    limit: 20,
  });

  return {
    claimed: claimed.count,
    completed,
    failed,
    pendingOutbox: pending.count,
    deadLettered: stale.deadLettered,
    error: null,
  };
}

export async function runRomaProjectHealthTick(options?: {
  gateway?: RomaProjectHealthGateway;
  workspaceId?: string;
  projectId?: string | null;
  limit?: number;
  scheduleLimit?: number;
  staleMinutes?: number;
  romaSubjectId?: string;
}): Promise<RomaProjectHealthTickReport> {
  const gateway = requireGateway(options?.gateway);
  const romaSubjectId = options?.romaSubjectId ?? ROMA_SUBJECT_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const scheduled = await gateway.tickRomaProjectHealthSchedules({
    subjectId: romaSubjectId,
    workspaceId,
    limit: options?.scheduleLimit ?? options?.limit ?? 10,
    projectId: options?.projectId ?? null,
  });
  const maxAttempts = Math.max(
    1,
    Number(process.env.MEMORY_OS_ROMA_PROJECT_HEALTH_MAX_ATTEMPTS ?? 3),
  );
  const stale = await gateway.deadLetterStaleJobs({
    subjectId: romaSubjectId,
    workspaceId,
    olderThanMinutes:
      options?.staleMinutes ??
      Number(process.env.MEMORY_OS_JOB_STALE_MINUTES ?? 60),
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
      const result = await executeRomaProjectHealthJob({
        gateway,
        job,
        romaSubjectId,
      });
      const notification = buildHealthNotification({ result });
      const completion = await gateway.completeRomaProjectHealth({
        subjectId: romaSubjectId,
        jobId: job.jobId,
        status: 'succeeded',
        memoryId: result.memoryId,
        auditEventId: result.auditEventId,
        notificationTitle: notification.title,
        notificationSeverity: notification.severity,
        notificationSourceMemoryIds: notification.sourceMemoryIds,
        notificationMetadata: notification.metadata,
      });
      completed.push({
        ...result,
        notificationIds: completion.notificationIds ?? [],
        notificationEventIds: completion.notificationEventIds ?? [],
        notificationAuditEventIds: completion.notificationAuditEventIds ?? [],
        notificationInsertedCount: completion.notificationInsertedCount ?? 0,
        notificationSeverity: notification.severity,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isRetryableRomaProjectHealthError(message)) {
        if (job.attempt + 1 >= maxAttempts) {
          await gateway.completeRomaProjectHealth({
            subjectId: romaSubjectId,
            jobId: job.jobId,
            status: 'dead_letter',
            error: message,
          });
        } else {
          await gateway.retryRomaProjectHealth({
            subjectId: romaSubjectId,
            jobId: job.jobId,
            error: message,
          });
        }
      } else {
        await gateway.completeRomaProjectHealth({
          subjectId: romaSubjectId,
          jobId: job.jobId,
          status: 'failed',
          error: message,
        });
      }
      failed.push({
        jobId: job.jobId,
        projectId: job.projectId,
        error: message,
      });
    }
  }

  const pending = await gateway.listOutboxPending({
    subjectId: romaSubjectId,
    workspaceId,
    eventType: 'roma.project_health.requested',
    limit: 20,
  });

  return {
    scheduled,
    claimed: claimed.count,
    completed,
    failed,
    pendingOutbox: pending.count,
    deadLettered: stale.deadLettered,
    error: null,
  };
}

export async function runRomaProjectHealthOnce(): Promise<RomaProjectHealthTickReport> {
  return runRomaProjectHealthTick();
}

export async function runRomaAutomationOnce(options?: {
  gateway?: RomaProjectHealthGateway;
  workspaceId?: string;
  projectId?: string | null;
  limit?: number;
  scheduleLimit?: number;
  staleMinutes?: number;
  romaSubjectId?: string;
}): Promise<RomaAutomationTickReport> {
  const qaFindings = await runRomaProjectFindingsTick({
    gateway: options?.gateway,
    workspaceId: options?.workspaceId,
    projectId: options?.projectId,
    limit: options?.limit,
    staleMinutes: options?.staleMinutes,
    romaSubjectId: options?.romaSubjectId,
  }).catch((err) => ({
    claimed: 0,
    completed: [],
    failed: [],
    pendingOutbox: 0,
    deadLettered: 0,
    error: err instanceof Error ? err.message : String(err),
  }));
  const projectHealth = await runRomaProjectHealthTick({
    gateway: options?.gateway,
    workspaceId: options?.workspaceId,
    projectId: options?.projectId,
    limit: options?.limit,
    scheduleLimit: options?.scheduleLimit,
    staleMinutes: options?.staleMinutes,
    romaSubjectId: options?.romaSubjectId,
  }).catch((err) => ({
    scheduled: {
      count: 0,
      enqueued: [],
      disabled: [],
      errors: [],
    },
    claimed: 0,
    completed: [],
    failed: [],
    pendingOutbox: 0,
    deadLettered: 0,
    error: err instanceof Error ? err.message : String(err),
  }));
  return {
    qaFindings,
    projectHealth,
  };
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
    const report = await runRomaAutomationOnce();
    const ok = report.qaFindings.error == null && report.projectHealth.error == null;
    console.log(JSON.stringify({ ok, ...report }));
    if (!ok) {
      const errors = [
        report.qaFindings.error ? `qaFindings: ${report.qaFindings.error}` : null,
        report.projectHealth.error ? `projectHealth: ${report.projectHealth.error}` : null,
      ].filter((value): value is string => value !== null);
      throw new Error(errors.join('; '));
    }
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

export const OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION = 'm18-s02-v1' as const;
export const DEFAULT_PROJECT_CONTEXT_MAX_TOKENS = 1800;
export const MIN_PROJECT_CONTEXT_MAX_TOKENS = 768;
export const MAX_PROJECT_CONTEXT_MAX_TOKENS = 8000;
export const PROJECT_CONTEXT_FRESHNESS_SLA_SECONDS = 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;

export type ProjectContextCitation = {
  id: string;
  kind: 'memory' | 'project_state' | 'handoff';
  sourceId: string;
  title: string | null;
  projectId: string;
  recordedAt: string | null;
  sourceEventId: string | null;
};

export type ProjectContextItem = {
  text: string;
  citations: string[];
};

export type ProjectContextDecision = {
  id: string;
  title: string;
  summary: string;
  status: string;
  recordedAt: string | null;
  citations: string[];
};

export type ProjectContextPack = {
  packVersion: typeof OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION;
  projectId: string;
  generatedAt: string;
  currentGoal: ProjectContextItem | null;
  canonicalDecisions: ProjectContextDecision[];
  currentMilestone: ProjectContextDecision | null;
  latestHandoff: {
    id: string;
    createdAt: string | null;
    fromSubjectId: string | null;
    toSubjectId: string | null;
    completed: ProjectContextItem[];
    validation: ProjectContextItem[];
    openItems: ProjectContextItem[];
    blockers: ProjectContextItem[];
    recommendedNext: ProjectContextItem[];
    citations: string[];
  } | null;
  activeBlockers: ProjectContextItem[];
  recentMerges: Array<{
    pullRequestUrl: string | null;
    mergeSha: string | null;
    title: string;
    citations: string[];
  }>;
  unresolvedConflicts: ProjectContextItem[];
  nextWork: ProjectContextItem[];
  sourceFreshness: {
    status: 'fresh' | 'stale' | 'unknown';
    newestRecordedAt: string | null;
    ageSeconds: number | null;
    slaSeconds: number;
    citations: string[];
  };
  citations: ProjectContextCitation[];
  provenance: {
    source: 'context.project';
    subjectScoped: true;
    explicitProject: true;
    sourceCount: number;
  };
  budget: {
    maxTokens: number;
    estimatedTokens: number;
    truncated: boolean;
    originalCounts: {
      decisions: number;
      tasks: number;
      facts: number;
      handoffItems: number;
    };
    includedCounts: {
      canonicalDecisions: number;
      blockers: number;
      recentMerges: number;
      conflicts: number;
      nextWork: number;
      handoffItems: number;
    };
  };
  text: string;
};

export const OFFICIAL_M18_PROJECT_CONTEXT_PACK = {
  version: OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION,
  roadmapSections: ['18', 'project-context-pack', 'shared-agent-lifecycle'],
  tokenBudget: {
    default: DEFAULT_PROJECT_CONTEXT_MAX_TOKENS,
    min: MIN_PROJECT_CONTEXT_MAX_TOKENS,
    max: MAX_PROJECT_CONTEXT_MAX_TOKENS,
  },
  requiredFields: [
    'currentGoal',
    'canonicalDecisions',
    'currentMilestone',
    'latestHandoff',
    'activeBlockers',
    'recentMerges',
    'unresolvedConflicts',
    'nextWork',
    'sourceFreshness',
    'citations',
    'provenance',
  ],
  invariants: {
    explicitProjectRequired: true,
    subjectScopedSourcesOnly: true,
    projectEchoMustMatch: true,
    crossProjectRecordFailsClosed: true,
    citationsRequiredForClaims: true,
    sourceFreshnessRequired: true,
    tokenBudgetRequired: true,
    noDefaultProjectFallback: true,
    modeAToolCount: 7,
  },
} as const;

function objectOf(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameProject(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function dateMs(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizedText(value: unknown, maxChars: number): string {
  const compact = stringOf(value).replace(/\s+/g, ' ');
  if (maxChars <= 0) return '';
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isNormalizedTextClipped(value: unknown, maxChars: number): boolean {
  return normalizedText(value, maxChars + 1).length > maxChars;
}

function isNoBlockerSentinel(value: string): boolean {
  let normalized = value.trim().toLowerCase();
  const leading = new Set(['-', '–', '—', '•']);
  const trailing = new Set(['.', ',', ':', ';', '!', '-']);
  while (normalized && leading.has(normalized[0] ?? '')) {
    normalized = normalized.slice(1).trimStart();
  }
  while (normalized && trailing.has(normalized.at(-1) ?? '')) {
    normalized = normalized.slice(0, -1).trimEnd();
  }
  return new Set([
    'none',
    'none observed',
    'no blockers',
    'no active blockers',
    'no known blockers',
    'n/a',
    'not applicable',
    'нет',
    'нет блокеров',
    'блокеров нет',
    'без блокеров',
  ]).has(normalized);
}

function uniqueNormalizedCount(values: string[]): number {
  return new Set(
    values.map((value) => normalizedText(value, Number.MAX_SAFE_INTEGER).toLowerCase())
      .filter(Boolean),
  ).size;
}

function estimatedTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function updateEstimatedTokens(pack: ProjectContextPack): void {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = estimatedTokens(pack);
    if (next === pack.budget.estimatedTokens) return;
    pack.budget.estimatedTokens = next;
  }
}

function memoryProjectId(memory: JsonRecord): string {
  return stringOf(
    memory.effectiveProjectId ??
      memory.effective_project_id ??
      memory.projectId ??
      memory.project_id,
  );
}

function memoryRecordedAt(memory: JsonRecord): string | null {
  return (
    stringOf(memory.recordedAt ?? memory.recorded_at ?? memory.created_at) || null
  );
}

function memorySourceEventId(memory: JsonRecord): string | null {
  return stringOf(memory.sourceEventId ?? memory.source_event_id) || null;
}

function citationForMemory(memory: JsonRecord, projectId: string): ProjectContextCitation {
  const id = normalizedText(memory.id, 128);
  return {
    id: `memory:${id}`,
    kind: 'memory',
    sourceId: id,
    title: normalizedText(memory.title, 220) || null,
    projectId,
    recordedAt: memoryRecordedAt(memory),
    sourceEventId: normalizedText(memorySourceEventId(memory), 128) || null,
  };
}

function decisionFromMemory(
  memory: JsonRecord,
  projectId: string,
  summaryChars: number,
  titleChars = 220,
): ProjectContextDecision {
  const citation = citationForMemory(memory, projectId);
  return {
    id: citation.sourceId,
    title: normalizedText(memory.title, titleChars) || 'Untitled decision',
    summary: normalizedText(memory.content, summaryChars),
    status: stringOf(memory.status) || 'unknown',
    recordedAt: citation.recordedAt,
    citations: [citation.id],
  };
}

const MAX_PARSED_CONTENT_CHARS = 50_000;

function valueAfterLabel(content: string, labels: string[]): string | null {
  const bounded = content.slice(0, MAX_PARSED_CONTENT_CHARS);
  const lower = bounded.toLowerCase();
  for (const label of labels) {
    const marker = `${label.toLowerCase()}:`;
    const at = lower.indexOf(marker);
    if (at < 0) continue;
    const start = at + marker.length;
    const newline = bounded.indexOf('\n', start);
    return bounded.slice(start, newline < 0 ? bounded.length : newline).trim() || null;
  }
  return null;
}

function nextWorkFromContent(content: string): string | null {
  return valueAfterLabel(content, [
    'Next canonical slice',
    'Next allowed slice',
    'Next slice',
  ]);
}

function blockersFromContent(content: string): string[] {
  const bounded = content.slice(0, MAX_PARSED_CONTENT_CHARS);
  const lower = bounded.toLowerCase();
  const labels = [
    'known external blockers remain:',
    'remaining blockers:',
    'blockers:',
  ];
  let start = -1;
  for (const label of labels) {
    const at = lower.indexOf(label);
    if (at >= 0 && (start < 0 || at < start)) start = at + label.length;
  }
  if (start < 0) return [];
  let end = bounded.length;
  for (const marker of [
    '\n\nnext',
    '\n\nverification',
    '\n\nrepository',
    '\nnext canonical slice:',
    '\nnext allowed slice:',
    '\nnext slice:',
  ]) {
    const at = lower.indexOf(marker, start);
    if (at >= 0 && at < end) end = at;
  }
  return bounded.slice(start, end)
    .split('\n')
    .flatMap((line) => line.split(';'))
    .map((value) => {
      const trimmed = value.trim();
      return trimmed.startsWith('-') ? trimmed.slice(1).trim() : trimmed;
    })
    .filter(Boolean);
}

function isAsciiAlphaNumericCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function standaloneWordIndex(value: string, word: string, from = 0): number {
  let at = value.indexOf(word, from);
  while (at >= 0) {
    const previous = at > 0 ? value.charCodeAt(at - 1) : -1;
    const afterIndex = at + word.length;
    const following = afterIndex < value.length ? value.charCodeAt(afterIndex) : -1;
    if (!isAsciiAlphaNumericCode(previous) && !isAsciiAlphaNumericCode(following)) {
      return at;
    }
    at = value.indexOf(word, at + 1);
  }
  return -1;
}

function hasMilestoneMarker(title: string): boolean {
  const lower = title.toLowerCase();
  if (
    standaloneWordIndex(lower, 'merged') >= 0 ||
    standaloneWordIndex(lower, 'applied') >= 0
  ) {
    return true;
  }
  const liveAt = standaloneWordIndex(lower, 'live');
  if (liveAt >= 0 && standaloneWordIndex(lower, 'pass', liveAt + 4) >= 0) {
    return true;
  }
  for (let index = 0; index < lower.length - 1; index += 1) {
    if (lower[index] !== 'm') continue;
    const previous = index > 0 ? lower.charCodeAt(index - 1) : -1;
    if (isAsciiAlphaNumericCode(previous)) continue;
    let cursor = index + 1;
    if (lower.charCodeAt(cursor) < 48 || lower.charCodeAt(cursor) > 57) continue;
    while (
      cursor < lower.length &&
      lower.charCodeAt(cursor) >= 48 &&
      lower.charCodeAt(cursor) <= 57
    ) {
      cursor += 1;
    }
    const following = cursor < lower.length ? lower.charCodeAt(cursor) : -1;
    if (!isAsciiAlphaNumericCode(following)) return true;
  }
  return false;
}

function githubPullRequestUrl(content: string): string | null {
  const bounded = content.slice(0, MAX_PARSED_CONTENT_CHARS);
  const marker = 'https://github.com/';
  let searchFrom = 0;
  while (searchFrom < bounded.length) {
    const at = bounded.indexOf(marker, searchFrom);
    if (at < 0) return null;
    let end = at;
    while (end < bounded.length) {
      const char = bounded[end];
      if (!char || char <= ' ' || [')', ']', '`', '"', "'"].includes(char)) break;
      end += 1;
    }
    const candidate = bounded.slice(at, end).replace(/[.,;:]$/, '');
    const pullAt = candidate.indexOf('/pull/');
    if (pullAt > marker.length) {
      const number = candidate.slice(pullAt + '/pull/'.length);
      if (number && [...number].every((char) => char >= '0' && char <= '9')) {
        return candidate;
      }
    }
    searchFrom = Math.max(end, at + marker.length);
  }
  return null;
}

function isFullHexSha(value: string): boolean {
  return (
    value.length === 40 &&
    [...value].every(
      (char) =>
        (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'),
    )
  );
}

function hasAffirmativeMergedValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    ['true', 'yes', 'done', 'complete', 'completed', 'merged'].includes(
      normalized,
    )
  ) {
    return true;
  }
  if (
    normalized.startsWith('https://') ||
    normalized.startsWith('http://')
  ) {
    return true;
  }
  return isFullHexSha(normalized);
}

function hasExplicitMergedMarker(content: string): boolean {
  return content
    .slice(0, MAX_PARSED_CONTENT_CHARS)
    .split('\n')
    .some((line) => {
      const normalized = line.trim().toLowerCase();
      const colonValue = normalized.startsWith('merged:')
        ? normalized.slice('merged:'.length)
        : null;
      const spacedValue = normalized.startsWith('merged ')
        ? normalized.slice('merged '.length)
        : null;
      return (
        normalized === 'merged' ||
        (colonValue !== null && hasAffirmativeMergedValue(colonValue)) ||
        (spacedValue !== null && hasAffirmativeMergedValue(spacedValue)) ||
        normalized === 'status: merged' ||
        normalized === 'status=merged' ||
        normalized === 'merge status: merged'
      );
    });
}

function mergeShaFromContent(content: string): string | null {
  for (const line of content.slice(0, MAX_PARSED_CONTENT_CHARS).split('\n')) {
    let normalized = line.trim().toLowerCase();
    if (
      ['-', '*', '+', '•', '–', '—'].includes(normalized[0] ?? '') &&
      normalized[1] === ' '
    ) {
      normalized = normalized.slice(2).trimStart();
    } else {
      let cursor = 0;
      while (
        cursor < normalized.length &&
        cursor < 9 &&
        normalized[cursor] >= '0' &&
        normalized[cursor] <= '9'
      ) {
        cursor += 1;
      }
      if (
        cursor > 0 &&
        ['.', ')'].includes(normalized[cursor] ?? '') &&
        normalized[cursor + 1] === ' '
      ) {
        normalized = normalized.slice(cursor + 2).trimStart();
      }
    }
    const marker = 'merge sha:';
    if (!normalized.startsWith(marker)) continue;
    const value = normalized.slice(marker.length).trim();
    if (isFullHexSha(value)) return value;
  }
  return null;
}

function hasMergeEvidence(content: string): boolean {
  return Boolean(mergeShaFromContent(content) || hasExplicitMergedMarker(content));
}

function stateValues(rawState: unknown, key: string): string[] {
  const stateRow = objectOf(rawState);
  const state = objectOf(stateRow.state);
  return arrayOf(state[key]).map(stringOf).filter(Boolean);
}

function valuesForKeys(rawValue: unknown, keys: string[]): string[] {
  const raw = objectOf(rawValue);
  for (const key of keys) {
    const values = arrayOf(raw[key]).map(stringOf).filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
}

function validateSources(
  values: unknown[],
  projectId: string,
): JsonRecord[] {
  return values.map(objectOf).filter((memory) => {
    const sourceProjectId = memoryProjectId(memory);
    if (sourceProjectId && !sameProject(sourceProjectId, projectId)) {
      throw new Error('project context source project mismatch');
    }
    return Boolean(stringOf(memory.id));
  });
}

export function resolveProjectContextMaxTokens(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_PROJECT_CONTEXT_MAX_TOKENS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('max_tokens must be a positive number');
  }
  return Math.min(
    MAX_PROJECT_CONTEXT_MAX_TOKENS,
    Math.max(MIN_PROJECT_CONTEXT_MAX_TOKENS, Math.floor(parsed)),
  );
}

export function buildProjectContextPack(
  rawValue: unknown,
  options: {
    projectId: string;
    maxTokens?: number;
    now?: Date;
  },
): ProjectContextPack {
  const projectId = options.projectId.trim();
  if (!projectId) throw new Error('project_id is required');
  const raw = objectOf(rawValue);
  const rawProjectId = stringOf(raw.projectId ?? raw.project_id);
  if (rawProjectId && !sameProject(rawProjectId, projectId)) {
    throw new Error('project context project mismatch');
  }

  const decisions = validateSources(arrayOf(raw.decisions), projectId).sort(
    (left, right) =>
      (dateMs(memoryRecordedAt(right)) ?? 0) -
      (dateMs(memoryRecordedAt(left)) ?? 0),
  );
  const tasks = validateSources(arrayOf(raw.tasks), projectId).sort(
    (left, right) =>
      (dateMs(memoryRecordedAt(right)) ?? 0) -
      (dateMs(memoryRecordedAt(left)) ?? 0),
  );
  const facts = validateSources(arrayOf(raw.facts), projectId);
  const maxTokens = resolveProjectContextMaxTokens(options.maxTokens);
  const now = options.now ?? new Date();
  const stateRow = objectOf(raw.state);
  const stateProjectId = stringOf(stateRow.projectId ?? stateRow.project_id);
  if (stateProjectId && !sameProject(stateProjectId, projectId)) {
    throw new Error('project context state project mismatch');
  }
  const noiseTitle = /^(?:ChatGPT smoke decision|Cursor .*receipt)/i;
  const canonicalCandidates = decisions.filter((memory) => {
    const status = stringOf(memory.status).toLowerCase();
    return (
      ['active', 'verified'].includes(status) &&
      !noiseTitle.test(stringOf(memory.title))
    );
  });
  const activeDecisionRanks = new Map(
    stateValues(raw.state, 'active_decisions').map((id, index) => [
      id.toLowerCase(),
      index,
    ]),
  );
  const canonicalSources = [...canonicalCandidates].sort((left, right) => {
    const leftRank = activeDecisionRanks.get(stringOf(left.id).toLowerCase());
    const rightRank = activeDecisionRanks.get(stringOf(right.id).toLowerCase());
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) -
        (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    return 0;
  });
  const operationalTasks = tasks.filter((memory) =>
    ['active', 'verified'].includes(stringOf(memory.status).toLowerCase())
  );
  const milestoneSource =
    canonicalCandidates.find((memory) =>
      hasMilestoneMarker(stringOf(memory.title))
    ) ?? null;
  const milestoneCitation = milestoneSource
    ? citationForMemory(milestoneSource, projectId)
    : null;
  const nextFromMilestone = milestoneSource
    ? nextWorkFromContent(stringOf(milestoneSource.content))
    : null;
  const blockerTexts = milestoneSource
    ? blockersFromContent(stringOf(milestoneSource.content))
    : [];
  const stateCitation: ProjectContextCitation | null = stringOf(stateRow.id)
    ? {
        id: `project-state:${normalizedText(stateRow.id, 128)}`,
        kind: 'project_state',
        sourceId: normalizedText(stateRow.id, 128),
        title: normalizedText(stateRow.summary, 220) || null,
        projectId,
        recordedAt:
          stringOf(
            stateRow.updatedAt ??
              stateRow.updated_at ??
              stateRow.createdAt ??
              stateRow.created_at,
          ) || null,
        sourceEventId: null,
      }
    : null;
  const handoffRow = objectOf(raw.latestHandoff ?? raw.latest_handoff);
  const handoffProjectId = stringOf(
    handoffRow.projectId ?? handoffRow.project_id,
  );
  if (handoffProjectId && !sameProject(handoffProjectId, projectId)) {
    throw new Error('project context handoff project mismatch');
  }
  const handoffPayload = objectOf(handoffRow.payload);
  const handoffCompleted = valuesForKeys(handoffPayload, ['completed']);
  const handoffValidation = valuesForKeys(handoffPayload, ['validation']);
  const handoffOpenItems = valuesForKeys(handoffPayload, [
    'open_items',
    'openItems',
  ]);
  const handoffBlockers = valuesForKeys(handoffPayload, ['blockers']);
  const handoffRecommendedNext = valuesForKeys(handoffPayload, [
    'recommended_next',
    'recommendedNext',
  ]);
  const handoffCreatedAt =
    stringOf(handoffRow.createdAt ?? handoffRow.created_at) || null;
  const handoffCitation: ProjectContextCitation | null = stringOf(handoffRow.id)
    ? {
        id: `handoff:${normalizedText(handoffRow.id, 128)}`,
        kind: 'handoff',
        sourceId: normalizedText(handoffRow.id, 128),
        title: 'Latest agent handoff',
        projectId,
        recordedAt: handoffCreatedAt,
        sourceEventId: null,
      }
    : null;
  const stateInProgress = stateValues(raw.state, 'in_progress');
  const stateNext = stateValues(raw.state, 'next');
  const statePayload = objectOf(stateRow.state);
  const stateDefinesNext =
    Object.prototype.hasOwnProperty.call(statePayload, 'in_progress') ||
    Object.prototype.hasOwnProperty.call(statePayload, 'next');
  const stateRecordedMs = dateMs(stateCitation?.recordedAt) ?? -1;
  const stateClearsNext = Boolean(
    stateCitation &&
      stateDefinesNext &&
      stateInProgress.length === 0 &&
      stateNext.length === 0,
  );
  const stateSupersedesNext = Boolean(stateCitation && stateDefinesNext);
  const nextSources: Array<{
    kind: 'handoff' | 'state' | 'milestone' | 'task';
    values: string[];
    citation: ProjectContextCitation | null;
    recordedMs: number;
  }> = [
    {
      kind: 'handoff' as const,
      values: [...handoffRecommendedNext, ...handoffOpenItems],
      citation: handoffCitation,
      recordedMs: dateMs(handoffCreatedAt) ?? -1,
    },
    {
      kind: 'state' as const,
      values: [...stateInProgress, ...stateNext],
      citation: stateCitation,
      recordedMs: dateMs(stateCitation?.recordedAt) ?? -1,
    },
    {
      kind: 'milestone' as const,
      values: nextFromMilestone ? [nextFromMilestone] : [],
      citation: milestoneCitation,
      recordedMs:
        dateMs(milestoneSource ? memoryRecordedAt(milestoneSource) : null) ?? -1,
    },
    ...operationalTasks.map((task) => {
      const title = stringOf(task.title);
      const content = stringOf(task.content);
      return {
        kind: 'task' as const,
        values: [
          normalizedText(
            title && content ? `${title}: ${content}` : title || content,
            420,
          ),
        ],
        citation: citationForMemory(task, projectId),
        recordedMs: dateMs(memoryRecordedAt(task)) ?? -1,
      };
    }),
  ].filter(
    (source) =>
      source.values.some(Boolean) &&
      !(
        stateSupersedesNext &&
        source.kind !== 'state' &&
        stateRecordedMs > source.recordedMs
      ),
  )
    .sort((left, right) => right.recordedMs - left.recordedMs);
  const currentNextSource = nextSources[0];
  const currentNext = currentNextSource?.values[0];
  const currentGoal = currentNext && currentNextSource
    ? {
        text: currentNextSource.kind === 'milestone'
          ? `Next canonical slice: ${normalizedText(currentNext, 420)}`
          : normalizedText(currentNext, 420),
        citations: currentNextSource.citation
          ? [currentNextSource.citation.id]
          : [],
      }
    : !stateClearsNext && stringOf(stateRow.summary)
      ? {
          text: normalizedText(stateRow.summary, 520),
          citations: stateCitation ? [stateCitation.id] : [],
        }
      : null;

  const stateBlocked = stateValues(raw.state, 'blocked');
  const stateDefinesBlocked = Object.prototype.hasOwnProperty.call(
    statePayload,
    'blocked',
  );
  const milestoneRecordedMs =
    dateMs(milestoneSource ? memoryRecordedAt(milestoneSource) : null) ?? -1;
  const stateSupersedesBlockers = Boolean(stateCitation && stateDefinesBlocked);
  const effectiveHandoffBlockers =
    stateSupersedesBlockers &&
      stateRecordedMs >= (dateMs(handoffCreatedAt) ?? -1)
      ? []
      : handoffBlockers;
  const effectiveMilestoneBlockers =
    stateSupersedesBlockers && stateRecordedMs >= milestoneRecordedMs
      ? []
      : blockerTexts;
  const blockerSources: Array<{
    values: string[];
    citation: ProjectContextCitation | null;
    recordedMs: number;
  }> = [
    {
      values: effectiveHandoffBlockers.filter(
        (value) => !isNoBlockerSentinel(value),
      ),
      citation: handoffCitation,
      recordedMs: dateMs(handoffCreatedAt) ?? -1,
    },
    {
      values: stateBlocked.filter((value) => !isNoBlockerSentinel(value)),
      citation: stateCitation,
      recordedMs: stateRecordedMs,
    },
    {
      values: effectiveMilestoneBlockers.filter(
        (value) => !isNoBlockerSentinel(value),
      ),
      citation: milestoneCitation,
      recordedMs: milestoneRecordedMs,
    },
  ].filter((source) => source.values.some(Boolean))
    .sort((left, right) => right.recordedMs - left.recordedMs);
  const stateConflicts = [
    ...stateValues(raw.state, 'unresolved_conflicts'),
    ...stateValues(raw.state, 'conflicts'),
    ...stateValues(raw.state, 'risks'),
  ];
  const allSources = [...decisions, ...tasks, ...facts];
  const originalBlockerCount = uniqueNormalizedCount(
    blockerSources.flatMap((source) => source.values),
  );
  const originalNextCount = uniqueNormalizedCount(
    nextSources.flatMap((source) => source.values),
  );
  const originalMergeCount = canonicalCandidates.filter((memory) =>
    hasMergeEvidence(stringOf(memory.content))
  ).length;
  const handoffTextValues = [
    ...handoffCompleted,
    ...handoffValidation,
    ...handoffOpenItems,
    ...handoffBlockers,
    ...handoffRecommendedNext,
  ];
  const boundedItemValues = [
    ...blockerSources.flatMap((source) => source.values),
    ...nextSources.flatMap((source) => source.values),
    ...stateConflicts,
    ...handoffTextValues,
  ];
  const builtInTextClipped =
    canonicalSources.some(
      (memory) =>
        isNormalizedTextClipped(memory.title, 220) ||
        isNormalizedTextClipped(memory.content, 420),
    ) ||
    allSources.some(
      (memory) =>
        isNormalizedTextClipped(memory.id, 128) ||
        isNormalizedTextClipped(memory.title, 220) ||
        isNormalizedTextClipped(memorySourceEventId(memory), 128),
    ) ||
    boundedItemValues.some((value) => isNormalizedTextClipped(value, 280)) ||
    Boolean(currentGoal && isNormalizedTextClipped(currentGoal.text, 420)) ||
    isNormalizedTextClipped(stateRow.summary, 220) ||
    isNormalizedTextClipped(stateRow.id, 128) ||
    isNormalizedTextClipped(handoffRow.id, 128);
  const newestSource = [...allSources].sort(
    (left, right) =>
      (dateMs(memoryRecordedAt(right)) ?? 0) -
      (dateMs(memoryRecordedAt(left)) ?? 0),
  )[0];
  const newestMemoryCitation = newestSource
    ? citationForMemory(newestSource, projectId)
    : null;
  const freshnessCitation = [
    newestMemoryCitation,
    stateCitation,
    handoffCitation,
  ]
    .filter((value): value is ProjectContextCitation => Boolean(value))
    .sort(
      (left, right) =>
        (dateMs(right.recordedAt) ?? -1) - (dateMs(left.recordedAt) ?? -1),
    )[0] ?? null;
  const newestAt = freshnessCitation?.recordedAt ?? null;
  const newestMs = dateMs(newestAt);
  const ageSeconds = newestMs === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - newestMs) / 1000));
  const handoffItemCount =
    handoffCompleted.length +
    handoffValidation.length +
    handoffOpenItems.length +
    handoffBlockers.length +
    handoffRecommendedNext.length;
  const originalCounts = {
    decisions: decisions.length,
    tasks: tasks.length,
    facts: facts.length,
    handoffItems: handoffItemCount,
  };

  let canonicalLimit = 6;
  let blockerLimit = 6;
  let mergeLimit = Math.min(5, originalMergeCount);
  let conflictLimit = 4;
  let nextLimit = 4;
  let handoffItemLimit = 4;
  let summaryChars = 420;
  let decisionTitleChars = 220;
  let itemChars = 280;
  let goalChars = 420;
  let citationTitleChars = 220;
  let expandedText = true;
  let includeCurrentMilestone = true;
  let includeLatestHandoff = true;
  const minimumCanonicalLimit = canonicalSources.length > 0 ? 1 : 0;
  const minimumMergeLimit = originalMergeCount > 0 ? 1 : 0;
  const minimumConflictLimit = stateConflicts.length > 0 ? 1 : 0;

  const create = (): ProjectContextPack => {
    const canonicalDecisions = canonicalSources
      .slice(0, canonicalLimit)
      .map((memory) =>
        decisionFromMemory(
          memory,
          projectId,
          summaryChars,
          decisionTitleChars,
        )
      );
    const currentMilestone = includeCurrentMilestone && milestoneSource
      ? decisionFromMemory(
          milestoneSource,
          projectId,
          summaryChars,
          decisionTitleChars,
        )
      : null;
    const boundedCurrentGoal = currentGoal
      ? {
          ...currentGoal,
          text: normalizedText(currentGoal.text, goalChars),
        }
      : null;
    const toItems = (
      values: string[],
      sourceCitation: ProjectContextCitation | null,
      limit: number,
    ): ProjectContextItem[] =>
      values.slice(0, limit).map((text) => ({
        text: normalizedText(text, itemChars),
        citations: sourceCitation ? [sourceCitation.id] : [],
      }));
    const latestHandoff = includeLatestHandoff && handoffCitation
      ? {
          id: handoffCitation.sourceId,
          createdAt: handoffCreatedAt,
          fromSubjectId:
            stringOf(handoffRow.fromSubjectId ?? handoffRow.from_subject_id) ||
            null,
          toSubjectId:
            stringOf(handoffRow.toSubjectId ?? handoffRow.to_subject_id) || null,
          completed: toItems(
            handoffCompleted,
            handoffCitation,
            handoffItemLimit,
          ),
          validation: toItems(
            handoffValidation,
            handoffCitation,
            handoffItemLimit,
          ),
          openItems: toItems(
            handoffOpenItems,
            handoffCitation,
            handoffItemLimit,
          ),
          blockers: toItems(
            handoffBlockers,
            handoffCitation,
            handoffItemLimit,
          ),
          recommendedNext: toItems(
            handoffRecommendedNext,
            handoffCitation,
            handoffItemLimit,
          ),
          citations: [handoffCitation.id],
        }
      : null;
    const blockerCandidates = blockerSources.flatMap((source) =>
      toItems(source.values, source.citation, blockerLimit)
    );
    const blockerSeen = new Set<string>();
    const activeBlockers = blockerCandidates.filter((item) => {
      const key = item.text.toLowerCase();
      if (!key || blockerSeen.has(key)) return false;
      blockerSeen.add(key);
      return true;
    }).slice(0, blockerLimit);
    const recentMerges = canonicalCandidates
      .map((memory) => {
        const content = stringOf(memory.content);
        const pullRequestUrl = githubPullRequestUrl(content);
        const mergeSha = mergeShaFromContent(content);
        return hasMergeEvidence(content)
          ? {
              pullRequestUrl,
              mergeSha,
              title: normalizedText(memory.title, decisionTitleChars),
              citations: [citationForMemory(memory, projectId).id],
            }
          : null;
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .slice(0, mergeLimit);
    const unresolvedConflicts = stateConflicts
      .slice(0, conflictLimit)
      .map((text) => ({
        text: normalizedText(text, 280),
        citations: stateCitation ? [stateCitation.id] : [],
      }));
    const nextCandidates = nextSources.flatMap((source) =>
      toItems(source.values, source.citation, nextLimit)
    );
    const nextSeen = new Set<string>();
    const nextWork = nextCandidates.filter((item) => {
      const key = item.text.toLowerCase();
      if (!key || nextSeen.has(key)) return false;
      nextSeen.add(key);
      return true;
    }).slice(0, nextLimit);

    const citationIds = new Set<string>();
    const collect = (items: Array<{ citations: string[] }>) =>
      items.forEach((item) => item.citations.forEach((id) => citationIds.add(id)));
    collect(canonicalDecisions);
    collect(activeBlockers);
    collect(recentMerges);
    collect(unresolvedConflicts);
    collect(nextWork);
    if (latestHandoff) {
      collect(latestHandoff.completed);
      collect(latestHandoff.validation);
      collect(latestHandoff.openItems);
      collect(latestHandoff.blockers);
      collect(latestHandoff.recommendedNext);
      latestHandoff.citations.forEach((id) => citationIds.add(id));
    }
    if (boundedCurrentGoal) collect([boundedCurrentGoal]);
    if (currentMilestone) collect([currentMilestone]);
    if (freshnessCitation) citationIds.add(freshnessCitation.id);
    const availableCitations = new Map<string, ProjectContextCitation>();
    for (const memory of allSources) {
      const citation = citationForMemory(memory, projectId);
      availableCitations.set(citation.id, {
        ...citation,
        title: citation.title
          ? normalizedText(citation.title, citationTitleChars) || null
          : null,
      });
    }
    if (stateCitation) {
      availableCitations.set(stateCitation.id, {
        ...stateCitation,
        title: stateCitation.title
          ? normalizedText(stateCitation.title, citationTitleChars) || null
          : null,
      });
    }
    if (handoffCitation) {
      availableCitations.set(handoffCitation.id, {
        ...handoffCitation,
        title: citationTitleChars > 0 ? handoffCitation.title : null,
      });
    }
    const citations = [...citationIds]
      .map((id) => availableCitations.get(id))
      .filter((value): value is ProjectContextCitation => Boolean(value));
    const text = expandedText
      ? [
          boundedCurrentGoal
            ? `Goal: ${boundedCurrentGoal.text}`
            : 'Goal: unavailable',
          currentMilestone
            ? `Milestone: ${currentMilestone.title}`
            : 'Milestone: unavailable',
          activeBlockers.length
            ? `Blockers: ${activeBlockers.map((item) => item.text).join('; ')}`
            : 'Blockers: none observed in readable current context',
          nextWork.length
            ? `Next: ${nextWork.map((item) => item.text).join('; ')}`
            : 'Next: unavailable',
        ].join('\n')
      : `Project ${projectId}; use structured fields and citations.`;
    const pack: ProjectContextPack = {
      packVersion: OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION,
      projectId,
      generatedAt: now.toISOString(),
      currentGoal: boundedCurrentGoal,
      canonicalDecisions,
      currentMilestone,
      latestHandoff,
      activeBlockers,
      recentMerges,
      unresolvedConflicts,
      nextWork,
      sourceFreshness: {
        status:
          ageSeconds === null
            ? 'unknown'
            : ageSeconds <= PROJECT_CONTEXT_FRESHNESS_SLA_SECONDS
              ? 'fresh'
              : 'stale',
        newestRecordedAt: newestAt,
        ageSeconds,
        slaSeconds: PROJECT_CONTEXT_FRESHNESS_SLA_SECONDS,
        citations: freshnessCitation ? [freshnessCitation.id] : [],
      },
      citations,
      provenance: {
        source: 'context.project',
        subjectScoped: true,
        explicitProject: true,
        sourceCount:
          allSources.length +
          (stateCitation ? 1 : 0) +
          (handoffCitation ? 1 : 0),
      },
      budget: {
        maxTokens,
        estimatedTokens: 0,
        truncated: false,
        originalCounts,
        includedCounts: {
          canonicalDecisions: canonicalDecisions.length,
          blockers: activeBlockers.length,
          recentMerges: recentMerges.length,
          conflicts: unresolvedConflicts.length,
          nextWork: nextWork.length,
          handoffItems: latestHandoff
            ? latestHandoff.completed.length +
              latestHandoff.validation.length +
              latestHandoff.openItems.length +
              latestHandoff.blockers.length +
              latestHandoff.recommendedNext.length
            : 0,
        },
      },
      text,
    };
    updateEstimatedTokens(pack);
    return pack;
  };

  let pack = create();
  let truncated = false;
  while (pack.budget.estimatedTokens > maxTokens) {
    truncated = true;
    if (mergeLimit > minimumMergeLimit) mergeLimit -= 1;
    else if (summaryChars > 80) summaryChars -= 40;
    else if (canonicalLimit > minimumCanonicalLimit) canonicalLimit -= 1;
    else if (blockerLimit > 1) blockerLimit -= 1;
    else if (nextLimit > 1) nextLimit -= 1;
    else if (handoffItemLimit > 1) handoffItemLimit -= 1;
    else if (nextLimit > 0) nextLimit = 0;
    else if (expandedText) expandedText = false;
    else if (conflictLimit > minimumConflictLimit) conflictLimit -= 1;
    else if (includeCurrentMilestone) includeCurrentMilestone = false;
    else if (goalChars > 120) goalChars -= 60;
    else if (itemChars > 120) itemChars -= 40;
    else if (decisionTitleChars > 80) decisionTitleChars -= 40;
    else if (citationTitleChars > 0) {
      citationTitleChars = Math.max(0, citationTitleChars - 40);
    } else if (summaryChars > 40) summaryChars -= 20;
    else if (handoffItemLimit > 0) handoffItemLimit = 0;
    else if (includeLatestHandoff) includeLatestHandoff = false;
    else if (blockerLimit > 0) blockerLimit = 0;
    else if (conflictLimit > 0) conflictLimit = 0;
    else break;
    pack = create();
  }
  const boundedBySectionCaps =
    pack.budget.includedCounts.canonicalDecisions < canonicalSources.length ||
    pack.budget.includedCounts.blockers < originalBlockerCount ||
    pack.budget.includedCounts.recentMerges < originalMergeCount ||
    pack.budget.includedCounts.conflicts < stateConflicts.length ||
    pack.budget.includedCounts.nextWork < originalNextCount ||
    pack.budget.includedCounts.handoffItems < handoffItemCount;
  pack.budget.truncated = truncated || boundedBySectionCaps || builtInTextClipped;
  updateEstimatedTokens(pack);
  if (pack.budget.estimatedTokens > maxTokens) {
    throw new Error('project context pack cannot satisfy max_tokens');
  }
  return pack;
}

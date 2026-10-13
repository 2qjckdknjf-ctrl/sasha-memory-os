export const EDGE_PROJECT_CONTEXT_PACK_VERSION = "m18-s02-v1";
export const EDGE_PROJECT_CONTEXT_DEFAULT_TOKENS = 1800;
export const EDGE_PROJECT_CONTEXT_MIN_TOKENS = 768;
export const EDGE_PROJECT_CONTEXT_MAX_TOKENS = 8000;
const FRESHNESS_SLA_SECONDS = 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;
type EdgeContextCitation = {
  id: string;
  kind: "memory" | "project_state" | "handoff";
  sourceId: string;
  title: string | null;
  projectId: string;
  recordedAt: string | null;
  sourceEventId: string | null;
};

function recordOf(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compact(value: unknown, maxChars: number): string {
  const text = textOf(value).replace(/\s+/g, " ");
  if (maxChars <= 0) return "";
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isCompactTextClipped(value: unknown, maxChars: number): boolean {
  return compact(value, maxChars + 1).length > maxChars;
}

function isNoBlockerSentinel(value: string): boolean {
  let normalized = value.trim().toLowerCase();
  const leading = new Set(["-", "–", "—", "•"]);
  const trailing = new Set([".", ",", ":", ";", "!", "-"]);
  while (normalized && leading.has(normalized[0] ?? "")) {
    normalized = normalized.slice(1).trimStart();
  }
  while (normalized && trailing.has(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1).trimEnd();
  }
  return new Set([
    "none",
    "none observed",
    "no blockers",
    "no active blockers",
    "no known blockers",
    "n/a",
    "not applicable",
    "нет",
    "нет блокеров",
    "блокеров нет",
    "без блокеров",
  ]).has(normalized);
}

function uniqueCompactCount(values: string[]): number {
  return new Set(
    values.map((value) => compact(value, Number.MAX_SAFE_INTEGER).toLowerCase())
      .filter(Boolean),
  ).size;
}

function dateMs(value: unknown): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function recordedAt(memory: JsonRecord): string | null {
  return textOf(memory.recordedAt ?? memory.recorded_at ?? memory.created_at) ||
    null;
}

function projectIdOf(memory: JsonRecord): string {
  return textOf(
    memory.effectiveProjectId ?? memory.effective_project_id ??
      memory.projectId ?? memory.project_id,
  );
}

function sourceEventIdOf(memory: JsonRecord): string | null {
  return textOf(memory.sourceEventId ?? memory.source_event_id) || null;
}

function citation(memory: JsonRecord, projectId: string): EdgeContextCitation {
  const sourceId = compact(memory.id, 128);
  return {
    id: `memory:${sourceId}`,
    kind: "memory" as const,
    sourceId,
    title: compact(memory.title, 220) || null,
    projectId,
    recordedAt: recordedAt(memory),
    sourceEventId: compact(sourceEventIdOf(memory), 128) || null,
  };
}

function decision(
  memory: JsonRecord,
  projectId: string,
  summaryChars: number,
  titleChars = 220,
) {
  const source = citation(memory, projectId);
  return {
    id: source.sourceId,
    title: compact(memory.title, titleChars) || "Untitled decision",
    summary: compact(memory.content, summaryChars),
    status: textOf(memory.status) || "unknown",
    recordedAt: source.recordedAt,
    citations: [source.id],
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
    const newline = bounded.indexOf("\n", start);
    return bounded.slice(start, newline < 0 ? bounded.length : newline).trim() || null;
  }
  return null;
}

function nextWorkFrom(content: string): string | null {
  return valueAfterLabel(content, [
    "Next canonical slice",
    "Next allowed slice",
    "Next slice",
  ]);
}

function blockersFrom(content: string): string[] {
  const bounded = content.slice(0, MAX_PARSED_CONTENT_CHARS);
  const lower = bounded.toLowerCase();
  const labels = [
    "known external blockers remain:",
    "remaining blockers:",
    "blockers:",
  ];
  let start = -1;
  for (const label of labels) {
    const at = lower.indexOf(label);
    if (at >= 0 && (start < 0 || at < start)) start = at + label.length;
  }
  if (start < 0) return [];
  let end = bounded.length;
  for (const marker of [
    "\n\nnext",
    "\n\nverification",
    "\n\nrepository",
    "\nnext canonical slice:",
  ]) {
    const at = lower.indexOf(marker, start);
    if (at >= 0 && at < end) end = at;
  }
  return bounded.slice(start, end)
    .split("\n")
    .flatMap((line) => line.split(";"))
    .map((value) => {
      const trimmed = value.trim();
      return trimmed.startsWith("-") ? trimmed.slice(1).trim() : trimmed;
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
    const following = afterIndex < value.length
      ? value.charCodeAt(afterIndex)
      : -1;
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
    standaloneWordIndex(lower, "merged") >= 0 ||
    standaloneWordIndex(lower, "applied") >= 0
  ) {
    return true;
  }
  const liveAt = standaloneWordIndex(lower, "live");
  if (liveAt >= 0 && standaloneWordIndex(lower, "pass", liveAt + 4) >= 0) {
    return true;
  }
  for (let index = 0; index < lower.length - 1; index += 1) {
    if (lower[index] !== "m") continue;
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
  const marker = "https://github.com/";
  let searchFrom = 0;
  while (searchFrom < bounded.length) {
    const at = bounded.indexOf(marker, searchFrom);
    if (at < 0) return null;
    let end = at;
    while (end < bounded.length) {
      const char = bounded[end];
      if (!char || char <= " " || [")", "]", "`", '"', "'"].includes(char)) break;
      end += 1;
    }
    const candidate = bounded.slice(at, end).replace(/[.,;:]$/, "");
    const pullAt = candidate.indexOf("/pull/");
    if (pullAt > marker.length) {
      const number = candidate.slice(pullAt + "/pull/".length);
      if (number && [...number].every((char) => char >= "0" && char <= "9")) {
        return candidate;
      }
    }
    searchFrom = Math.max(end, at + marker.length);
  }
  return null;
}

function hasExplicitMergedMarker(content: string): boolean {
  return content
    .slice(0, MAX_PARSED_CONTENT_CHARS)
    .split("\n")
    .some((line) => {
      const normalized = line.trim().toLowerCase();
      return normalized === "merged" ||
        normalized.startsWith("merged:") ||
        normalized.startsWith("merged ") ||
        normalized === "status: merged" ||
        normalized === "status=merged" ||
        normalized === "merge status: merged";
    });
}

function mergeShaFromContent(content: string): string | null {
  return /(?:Merge SHA:|merge SHA)\s*([0-9a-f]{40})/i.exec(content)?.[1] ?? null;
}

function hasMergeEvidence(content: string): boolean {
  return Boolean(mergeShaFromContent(content) || hasExplicitMergedMarker(content));
}

function stateValues(rawState: unknown, key: string): string[] {
  const state = recordOf(recordOf(rawState).state);
  return listOf(state[key]).map(textOf).filter(Boolean);
}

function valuesForKeys(rawValue: unknown, keys: string[]): string[] {
  const raw = recordOf(rawValue);
  for (const key of keys) {
    const values = listOf(raw[key]).map(textOf).filter(Boolean);
    if (values.length > 0) return values;
  }
  return [];
}

function validatedSources(
  values: unknown[],
  projectId: string,
): JsonRecord[] {
  return values.map(recordOf).filter((memory) => {
    const sourceProjectId = projectIdOf(memory);
    if (
      sourceProjectId &&
      sourceProjectId.trim().toLowerCase() !== projectId.trim().toLowerCase()
    ) {
      throw new Error("project context source project mismatch");
    }
    return Boolean(textOf(memory.id));
  });
}

export function resolveEdgeProjectContextMaxTokens(value: unknown): number {
  const parsed = Number(value ?? EDGE_PROJECT_CONTEXT_DEFAULT_TOKENS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("max_tokens must be a positive number");
  }
  return Math.min(
    EDGE_PROJECT_CONTEXT_MAX_TOKENS,
    Math.max(EDGE_PROJECT_CONTEXT_MIN_TOKENS, Math.floor(parsed)),
  );
}

export function buildEdgeProjectContextPack(
  rawValue: unknown,
  options: { projectId: string; maxTokens?: unknown; now?: Date },
) {
  const projectId = options.projectId.trim();
  if (!projectId) throw new Error("project_id is required");
  const raw = recordOf(rawValue);
  const rawProjectId = textOf(raw.projectId ?? raw.project_id);
  if (
    rawProjectId &&
    rawProjectId.trim().toLowerCase() !== projectId.trim().toLowerCase()
  ) {
    throw new Error("project context project mismatch");
  }

  const decisions = validatedSources(listOf(raw.decisions), projectId).sort(
    (left, right) =>
      (dateMs(recordedAt(right)) ?? 0) - (dateMs(recordedAt(left)) ?? 0),
  );
  const tasks = validatedSources(listOf(raw.tasks), projectId).sort(
    (left, right) =>
      (dateMs(recordedAt(right)) ?? 0) - (dateMs(recordedAt(left)) ?? 0),
  );
  const facts = validatedSources(listOf(raw.facts), projectId);
  const allSources = [...decisions, ...tasks, ...facts];
  const maxTokens = resolveEdgeProjectContextMaxTokens(options.maxTokens);
  const now = options.now ?? new Date();
  const stateRow = recordOf(raw.state);
  const stateProjectId = textOf(stateRow.projectId ?? stateRow.project_id);
  if (
    stateProjectId &&
    stateProjectId.trim().toLowerCase() !== projectId.trim().toLowerCase()
  ) {
    throw new Error("project context state project mismatch");
  }
  const canonicalCandidates = decisions.filter((memory) => {
    const status = textOf(memory.status).toLowerCase();
    return ["active", "verified"].includes(status) &&
      !/^(?:ChatGPT smoke decision|Cursor .*receipt)/i.test(
        textOf(memory.title),
      );
  });
  const activeDecisionRanks = new Map(
    stateValues(raw.state, "active_decisions").map((id, index) => [
      id.toLowerCase(),
      index,
    ]),
  );
  const canonicalSources = [...canonicalCandidates].sort((left, right) => {
    const leftRank = activeDecisionRanks.get(textOf(left.id).toLowerCase());
    const rightRank = activeDecisionRanks.get(textOf(right.id).toLowerCase());
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) -
        (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    return 0;
  });
  const operationalTasks = tasks.filter((memory) =>
    ["active", "verified"].includes(textOf(memory.status).toLowerCase())
  );
  const milestoneSource = canonicalCandidates.find((memory) =>
    hasMilestoneMarker(textOf(memory.title))
  ) ?? canonicalCandidates[0] ?? null;
  const milestoneCitation = milestoneSource
    ? citation(milestoneSource, projectId)
    : null;
  const nextFromMilestone = milestoneSource
    ? nextWorkFrom(textOf(milestoneSource.content))
    : null;
  const blockerTexts = milestoneSource
    ? blockersFrom(textOf(milestoneSource.content))
    : [];
  const stateCitation = textOf(stateRow.id)
    ? {
      id: `project-state:${compact(stateRow.id, 128)}`,
      kind: "project_state" as const,
      sourceId: compact(stateRow.id, 128),
      title: compact(stateRow.summary, 220) || null,
      projectId,
      recordedAt: textOf(
        stateRow.updatedAt ?? stateRow.updated_at ??
          stateRow.createdAt ?? stateRow.created_at,
      ) || null,
      sourceEventId: null,
    }
    : null;
  const handoffRow = recordOf(raw.latestHandoff ?? raw.latest_handoff);
  const handoffProjectId = textOf(
    handoffRow.projectId ?? handoffRow.project_id,
  );
  if (
    handoffProjectId &&
    handoffProjectId.trim().toLowerCase() !== projectId.trim().toLowerCase()
  ) {
    throw new Error("project context handoff project mismatch");
  }
  const handoffPayload = recordOf(handoffRow.payload);
  const handoffCompleted = valuesForKeys(handoffPayload, ["completed"]);
  const handoffValidation = valuesForKeys(handoffPayload, ["validation"]);
  const handoffOpenItems = valuesForKeys(handoffPayload, [
    "open_items",
    "openItems",
  ]);
  const handoffBlockers = valuesForKeys(handoffPayload, ["blockers"]);
  const handoffRecommendedNext = valuesForKeys(handoffPayload, [
    "recommended_next",
    "recommendedNext",
  ]);
  const handoffCreatedAt =
    textOf(handoffRow.createdAt ?? handoffRow.created_at) || null;
  const handoffCitation: EdgeContextCitation | null = textOf(handoffRow.id)
    ? {
      id: `handoff:${compact(handoffRow.id, 128)}`,
      kind: "handoff" as const,
      sourceId: compact(handoffRow.id, 128),
      title: "Latest agent handoff",
      projectId,
      recordedAt: handoffCreatedAt,
      sourceEventId: null,
    }
    : null;
  const stateInProgress = stateValues(raw.state, "in_progress");
  const stateNext = stateValues(raw.state, "next");
  const statePayload = recordOf(stateRow.state);
  const stateDefinesNext =
    Object.prototype.hasOwnProperty.call(statePayload, "in_progress") ||
    Object.prototype.hasOwnProperty.call(statePayload, "next");
  const stateRecordedMs = dateMs(stateCitation?.recordedAt) ?? -1;
  const stateClearsNext = Boolean(
    stateCitation &&
      stateDefinesNext &&
      stateInProgress.length === 0 &&
      stateNext.length === 0,
  );
  const nextSources: Array<{
    kind: "handoff" | "state" | "milestone" | "task";
    values: string[];
    citation: EdgeContextCitation | null;
    recordedMs: number;
  }> = [
    {
      kind: "handoff" as const,
      values: handoffRecommendedNext,
      citation: handoffCitation,
      recordedMs: dateMs(handoffCreatedAt) ?? -1,
    },
    {
      kind: "state" as const,
      values: [...stateInProgress, ...stateNext],
      citation: stateCitation,
      recordedMs: dateMs(stateCitation?.recordedAt) ?? -1,
    },
    {
      kind: "milestone" as const,
      values: nextFromMilestone ? [nextFromMilestone] : [],
      citation: milestoneCitation,
      recordedMs:
        dateMs(milestoneSource ? recordedAt(milestoneSource) : null) ?? -1,
    },
    ...operationalTasks.map((task) => {
      const title = textOf(task.title);
      const content = textOf(task.content);
      return {
        kind: "task" as const,
        values: [
          compact(
            title && content ? `${title}: ${content}` : title || content,
            420,
          ),
        ],
        citation: citation(task, projectId),
        recordedMs: dateMs(recordedAt(task)) ?? -1,
      };
    }),
  ].filter(
    (source) =>
      source.values.some(Boolean) &&
      !(
        stateClearsNext &&
        source.kind !== "state" &&
        stateRecordedMs >= source.recordedMs
      ),
  )
    .sort((left, right) => right.recordedMs - left.recordedMs);
  const currentNextSource = nextSources[0];
  const currentNext = currentNextSource?.values[0];
  const currentGoal = currentNext && currentNextSource
    ? {
      text: currentNextSource.kind === "milestone"
        ? `Next canonical slice: ${compact(currentNext, 420)}`
        : compact(currentNext, 420),
      citations: currentNextSource.citation
        ? [currentNextSource.citation.id]
        : [],
    }
    : !stateClearsNext && textOf(stateRow.summary)
    ? {
      text: compact(stateRow.summary, 520),
      citations: stateCitation ? [stateCitation.id] : [],
    }
    : null;
  const newestSource = [...allSources].sort(
    (left, right) =>
      (dateMs(recordedAt(right)) ?? 0) - (dateMs(recordedAt(left)) ?? 0),
  )[0];
  const newestMemoryCitation = newestSource
    ? citation(newestSource, projectId)
    : null;
  const freshnessCitation = [
    newestMemoryCitation,
    stateCitation,
    handoffCitation,
  ]
    .filter((value): value is EdgeContextCitation => Boolean(value))
    .sort(
      (left, right) =>
        (dateMs(right.recordedAt) ?? -1) - (dateMs(left.recordedAt) ?? -1),
    )[0] ?? null;
  const newestRecordedAt = freshnessCitation?.recordedAt ?? null;
  const newestMs = dateMs(newestRecordedAt);
  const ageSeconds = newestMs === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - newestMs) / 1000));
  const stateBlocked = stateValues(raw.state, "blocked");
  const stateDefinesBlocked = Object.prototype.hasOwnProperty.call(
    statePayload,
    "blocked",
  );
  const milestoneRecordedMs =
    dateMs(milestoneSource ? recordedAt(milestoneSource) : null) ?? -1;
  const stateSupersedesBlockers = Boolean(stateCitation && stateDefinesBlocked);
  const effectiveHandoffBlockers =
    stateSupersedesBlockers &&
      stateRecordedMs >= (dateMs(handoffCreatedAt) ?? -1)
      ? []
      : [...handoffBlockers, ...handoffOpenItems];
  const effectiveMilestoneBlockers =
    stateSupersedesBlockers && stateRecordedMs >= milestoneRecordedMs
      ? []
      : blockerTexts;
  const blockerSources: Array<{
    values: string[];
    citation: EdgeContextCitation | null;
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
    ...stateValues(raw.state, "unresolved_conflicts"),
    ...stateValues(raw.state, "conflicts"),
    ...stateValues(raw.state, "risks"),
  ];
  const originalBlockerCount = uniqueCompactCount(
    blockerSources.flatMap((source) => source.values),
  );
  const originalNextCount = uniqueCompactCount(
    nextSources.flatMap((source) => source.values),
  );
  const originalMergeCount = canonicalCandidates.filter((memory) =>
    hasMergeEvidence(textOf(memory.content))
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
        isCompactTextClipped(memory.title, 220) ||
        isCompactTextClipped(memory.content, 420),
    ) ||
    allSources.some(
      (memory) =>
        isCompactTextClipped(memory.id, 128) ||
        isCompactTextClipped(memory.title, 220) ||
        isCompactTextClipped(sourceEventIdOf(memory), 128),
    ) ||
    boundedItemValues.some((value) => isCompactTextClipped(value, 280)) ||
    Boolean(currentGoal && isCompactTextClipped(currentGoal.text, 420)) ||
    isCompactTextClipped(stateRow.summary, 220) ||
    isCompactTextClipped(stateRow.id, 128) ||
    isCompactTextClipped(handoffRow.id, 128);
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
  let mergeLimit = 5;
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
  const minimumConflictLimit = stateConflicts.length > 0 ? 1 : 0;

  const create = () => {
    const canonicalDecisions = canonicalSources.slice(0, canonicalLimit)
      .map((memory) =>
        decision(memory, projectId, summaryChars, decisionTitleChars)
      );
    const currentMilestone = includeCurrentMilestone && milestoneSource
      ? decision(
        milestoneSource,
        projectId,
        summaryChars,
        decisionTitleChars,
      )
      : null;
    const boundedCurrentGoal = currentGoal
      ? { ...currentGoal, text: compact(currentGoal.text, goalChars) }
      : null;
    const toItems = (
      values: string[],
      sourceCitation: EdgeContextCitation | null,
      limit: number,
    ) => values.slice(0, limit).map((value) => ({
      text: compact(value, itemChars),
      citations: sourceCitation ? [sourceCitation.id] : [],
    }));
    const latestHandoff = includeLatestHandoff && handoffCitation
      ? {
        id: handoffCitation.sourceId,
        createdAt: handoffCreatedAt,
        fromSubjectId:
          textOf(handoffRow.fromSubjectId ?? handoffRow.from_subject_id) || null,
        toSubjectId:
          textOf(handoffRow.toSubjectId ?? handoffRow.to_subject_id) || null,
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
    const recentMerges = canonicalCandidates.map((memory) => {
      const content = textOf(memory.content);
      const pullRequestUrl = githubPullRequestUrl(content);
      const mergeSha = mergeShaFromContent(content);
      return hasMergeEvidence(content)
        ? {
          pullRequestUrl,
          mergeSha,
          title: compact(memory.title, decisionTitleChars),
          citations: [citation(memory, projectId).id],
        }
        : null;
    }).filter((value) => value !== null).slice(0, mergeLimit);
    const unresolvedConflicts = stateConflicts.slice(0, conflictLimit).map(
      (value) => ({
        text: compact(value, 280),
        citations: stateCitation ? [stateCitation.id] : [],
      }),
    );
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
    const available = new Map<string, EdgeContextCitation>();
    for (const source of allSources) {
      const sourceCitation = citation(source, projectId);
      available.set(sourceCitation.id, {
        ...sourceCitation,
        title: sourceCitation.title
          ? compact(sourceCitation.title, citationTitleChars) || null
          : null,
      });
    }
    if (stateCitation) {
      available.set(stateCitation.id, {
        ...stateCitation,
        title: stateCitation.title
          ? compact(stateCitation.title, citationTitleChars) || null
          : null,
      });
    }
    if (handoffCitation) {
      available.set(handoffCitation.id, {
        ...handoffCitation,
        title: citationTitleChars > 0 ? handoffCitation.title : null,
      });
    }
    const citations = [...citationIds].flatMap((id) => {
      const value = available.get(id);
      return value ? [value] : [];
    });
    const text = expandedText
      ? [
        boundedCurrentGoal
          ? `Goal: ${boundedCurrentGoal.text}`
          : "Goal: unavailable",
        currentMilestone
          ? `Milestone: ${currentMilestone.title}`
          : "Milestone: unavailable",
        activeBlockers.length
          ? `Blockers: ${activeBlockers.map((item) => item.text).join("; ")}`
          : "Blockers: none observed in readable current context",
        nextWork.length
          ? `Next: ${nextWork.map((item) => item.text).join("; ")}`
          : "Next: unavailable",
      ].join("\n")
      : `Project ${projectId}; use structured fields and citations.`;
    const pack = {
      packVersion: EDGE_PROJECT_CONTEXT_PACK_VERSION,
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
        status: ageSeconds === null
          ? "unknown"
          : ageSeconds <= FRESHNESS_SLA_SECONDS
          ? "fresh"
          : "stale",
        newestRecordedAt,
        ageSeconds,
        slaSeconds: FRESHNESS_SLA_SECONDS,
        citations: freshnessCitation ? [freshnessCitation.id] : [],
      },
      citations,
      provenance: {
        source: "context.project",
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
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const next = Math.ceil(JSON.stringify(pack).length / 4);
      if (next === pack.budget.estimatedTokens) break;
      pack.budget.estimatedTokens = next;
    }
    return pack;
  };

  let pack = create();
  let truncated = false;
  while (pack.budget.estimatedTokens > maxTokens) {
    truncated = true;
    if (mergeLimit > 0) mergeLimit -= 1;
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = Math.ceil(JSON.stringify(pack).length / 4);
    if (next === pack.budget.estimatedTokens) break;
    pack.budget.estimatedTokens = next;
  }
  if (pack.budget.estimatedTokens > maxTokens) {
    throw new Error("project context pack cannot satisfy max_tokens");
  }
  return pack;
}

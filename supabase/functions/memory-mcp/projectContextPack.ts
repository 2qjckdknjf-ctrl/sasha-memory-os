export const EDGE_PROJECT_CONTEXT_PACK_VERSION = "m18-s02-v1";
export const EDGE_PROJECT_CONTEXT_DEFAULT_TOKENS = 1800;
export const EDGE_PROJECT_CONTEXT_MIN_TOKENS = 768;
export const EDGE_PROJECT_CONTEXT_MAX_TOKENS = 8000;
const FRESHNESS_SLA_SECONDS = 24 * 60 * 60;

type JsonRecord = Record<string, unknown>;
type EdgeContextCitation = {
  id: string;
  kind: "memory" | "project_state";
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

function decision(memory: JsonRecord, projectId: string, summaryChars: number) {
  const source = citation(memory, projectId);
  return {
    id: source.sourceId,
    title: compact(memory.title, 220) || "Untitled decision",
    summary: compact(memory.content, summaryChars),
    status: textOf(memory.status) || "unknown",
    recordedAt: source.recordedAt,
    citations: [source.id],
  };
}

function nextWorkFrom(content: string): string | null {
  return /(?:Next canonical slice|Next allowed slice|Next slice):\s*([^\n]+)/i
    .exec(content)?.[1]?.trim() || null;
}

function blockersFrom(content: string): string[] {
  const match =
    /(?:Known external blockers remain|Remaining blockers|Blockers):\s*([\s\S]*?)(?=\n\s*\n(?:Next|Verification|Repository)|\nNext canonical slice:|$)/i
      .exec(content);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\n\s*-\s+|;\s+/)
    .map((value) => value.replace(/^[-\s]+/, "").trim())
    .filter(Boolean);
}

function stateValues(rawState: unknown, key: string): string[] {
  const state = recordOf(recordOf(rawState).state);
  return listOf(state[key]).map(textOf).filter(Boolean);
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
  const tasks = validatedSources(listOf(raw.tasks), projectId);
  const facts = validatedSources(listOf(raw.facts), projectId);
  const allSources = [...decisions, ...tasks, ...facts];
  const maxTokens = resolveEdgeProjectContextMaxTokens(options.maxTokens);
  const now = options.now ?? new Date();
  const canonicalSources = decisions.filter((memory) =>
    !/^(?:ChatGPT smoke decision|Cursor .*receipt)/i.test(textOf(memory.title))
  );
  const milestoneSource = canonicalSources.find((memory) =>
    /(?:M\d+(?:\.\d+)?|LIVE .*PASS|MERGED|APPLIED)/i.test(textOf(memory.title))
  ) ?? canonicalSources[0] ?? null;
  const milestoneCitation = milestoneSource
    ? citation(milestoneSource, projectId)
    : null;
  const nextFromMilestone = milestoneSource
    ? nextWorkFrom(textOf(milestoneSource.content))
    : null;
  const blockerTexts = milestoneSource
    ? blockersFrom(textOf(milestoneSource.content))
    : [];
  const stateRow = recordOf(raw.state);
  const stateProjectId = textOf(stateRow.projectId ?? stateRow.project_id);
  if (
    stateProjectId &&
    stateProjectId.trim().toLowerCase() !== projectId.trim().toLowerCase()
  ) {
    throw new Error("project context state project mismatch");
  }
  const stateCitation = textOf(stateRow.id)
    ? {
      id: `project-state:${textOf(stateRow.id)}`,
      kind: "project_state" as const,
      sourceId: textOf(stateRow.id),
      title: textOf(stateRow.summary) || null,
      projectId,
      recordedAt: textOf(stateRow.updated_at ?? stateRow.created_at) || null,
      sourceEventId: null,
    }
    : null;
  const currentGoal = nextFromMilestone
    ? {
      text: `Next canonical slice: ${compact(nextFromMilestone, 420)}`,
      citations: milestoneCitation ? [milestoneCitation.id] : [],
    }
    : textOf(stateRow.summary)
    ? {
      text: compact(stateRow.summary, 520),
      citations: stateCitation ? [stateCitation.id] : [],
    }
    : null;
  const newestSource = [...allSources].sort(
    (left, right) =>
      (dateMs(recordedAt(right)) ?? 0) - (dateMs(recordedAt(left)) ?? 0),
  )[0];
  const newestRecordedAt = newestSource ? recordedAt(newestSource) : null;
  const newestMs = dateMs(newestRecordedAt);
  const ageSeconds = newestMs === null
    ? null
    : Math.max(0, Math.floor((now.getTime() - newestMs) / 1000));
  const freshnessCitation = newestSource
    ? citation(newestSource, projectId)
    : null;
  const stateBlocked = stateValues(raw.state, "blocked");
  const stateConflicts = [
    ...stateValues(raw.state, "unresolved_conflicts"),
    ...stateValues(raw.state, "conflicts"),
  ];
  const stateNext = stateValues(raw.state, "next");
  const originalCounts = {
    decisions: decisions.length,
    tasks: tasks.length,
    facts: facts.length,
  };

  let canonicalLimit = 6;
  let blockerLimit = 6;
  let mergeLimit = 5;
  let conflictLimit = 4;
  let nextLimit = 4;
  let summaryChars = 420;
  let expandedText = true;

  const create = () => {
    const canonicalDecisions = canonicalSources.slice(0, canonicalLimit)
      .map((memory) => decision(memory, projectId, summaryChars));
    const currentMilestone = milestoneSource
      ? decision(milestoneSource, projectId, summaryChars)
      : null;
    const blockerSource = blockerTexts.length ? blockerTexts : stateBlocked;
    const blockerCitation = blockerTexts.length
      ? milestoneCitation
      : stateCitation;
    const activeBlockers = blockerSource.slice(0, blockerLimit).map((value) => ({
      text: compact(value, 280),
      citations: blockerCitation ? [blockerCitation.id] : [],
    }));
    const recentMerges = canonicalSources.map((memory) => {
      const content = textOf(memory.content);
      const pullRequestUrl =
        /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/.exec(content)?.[0] ?? null;
      const mergeSha =
        /(?:Merge SHA:|merge SHA)\s*([0-9a-f]{40})/i.exec(content)?.[1] ?? null;
      return pullRequestUrl || mergeSha
        ? {
          pullRequestUrl,
          mergeSha,
          title: compact(memory.title, 220),
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
    const nextSource = nextFromMilestone ? [nextFromMilestone] : stateNext;
    const nextCitation = nextFromMilestone ? milestoneCitation : stateCitation;
    const nextWork = nextSource.slice(0, nextLimit).map((value) => ({
      text: compact(value, 280),
      citations: nextCitation ? [nextCitation.id] : [],
    }));
    const citationIds = new Set<string>();
    const collect = (items: Array<{ citations: string[] }>) =>
      items.forEach((item) => item.citations.forEach((id) => citationIds.add(id)));
    collect(canonicalDecisions);
    collect(activeBlockers);
    collect(recentMerges);
    collect(unresolvedConflicts);
    collect(nextWork);
    if (currentGoal) collect([currentGoal]);
    if (currentMilestone) collect([currentMilestone]);
    if (freshnessCitation) citationIds.add(freshnessCitation.id);
    const available = new Map<string, EdgeContextCitation>();
    for (const source of allSources) {
      const sourceCitation = citation(source, projectId);
      available.set(sourceCitation.id, sourceCitation);
    }
    if (stateCitation) available.set(stateCitation.id, stateCitation);
    const citations = [...citationIds].flatMap((id) => {
      const value = available.get(id);
      return value ? [value] : [];
    });
    const text = expandedText
      ? [
        currentGoal ? `Goal: ${currentGoal.text}` : "Goal: unavailable",
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
      currentGoal,
      canonicalDecisions,
      currentMilestone,
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
        sourceCount: allSources.length + (stateCitation ? 1 : 0),
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
    if (canonicalLimit > 0) canonicalLimit -= 1;
    else if (mergeLimit > 0) mergeLimit -= 1;
    else if (blockerLimit > 1) blockerLimit -= 1;
    else if (nextLimit > 1) nextLimit -= 1;
    else if (conflictLimit > 0) conflictLimit -= 1;
    else if (summaryChars > 80) summaryChars -= 40;
    else if (blockerLimit > 0) blockerLimit = 0;
    else if (expandedText) expandedText = false;
    else break;
    pack = create();
  }
  pack.budget.truncated = truncated ||
    pack.budget.includedCounts.canonicalDecisions < canonicalSources.length;
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

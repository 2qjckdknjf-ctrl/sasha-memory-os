import { cosineSimilarity, createEmbeddingAdapter } from './embeddings.js';

export type ConsolidateCandidate = {
  id: string;
  title: string;
  content: string;
  status: string;
  recordedAt?: string;
  embedding?: number[] | null;
};

export type ConsolidationPair = {
  keeperId: string;
  duplicateId: string;
  score: number;
  reason: string;
};

export const PROACTIVE_CONSOLIDATION_RULES_VERSION = 'm13-s03-v1';

export type ProactiveConsolidationCandidate = ConsolidateCandidate & {
  projectId?: string | null;
  importance?: number;
  confidence?: number;
};

export type ProactiveConsolidationConflict = {
  title: string;
  reason: 'same-title-divergent-content' | 'same-title-reviewed-history';
  memoryIds: string[];
  statuses: string[];
  recordedAts: string[];
};

export type ProactiveConsolidationStopReason =
  | 'completed'
  | 'max_records'
  | 'max_merges'
  | 'max_conflicts'
  | 'max_time_ms';

export type ProactiveConsolidationPlan = {
  rulesVersion: string;
  scanned: number;
  inputMemoryIds: string[];
  mergeCandidates: ConsolidationPair[];
  mergeCandidatesTotal: number;
  candidateConflicts: ProactiveConsolidationConflict[];
  candidateConflictsTotal: number;
  stopReason: ProactiveConsolidationStopReason;
  exhausted: boolean;
  verifiedWrites: 0;
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sortForProactiveConsolidation(
  left: ProactiveConsolidationCandidate,
  right: ProactiveConsolidationCandidate,
): number {
  const byRecordedAt = (right.recordedAt ?? '').localeCompare(left.recordedAt ?? '');
  if (byRecordedAt !== 0) return byRecordedAt;
  const byTitle = normalizeTitle(left.title).localeCompare(normalizeTitle(right.title));
  if (byTitle !== 0) return byTitle;
  return left.id.localeCompare(right.id);
}

function isCurrentishStatus(status: string): boolean {
  return (
    status === 'candidate' ||
    status === 'active' ||
    status === 'verified' ||
    status === 'disputed'
  );
}

function buildConflictCandidates(
  candidates: ProactiveConsolidationCandidate[],
  mergePairs: ConsolidationPair[],
): ProactiveConsolidationConflict[] {
  const titleGroups = new Map<string, ProactiveConsolidationCandidate[]>();
  for (const candidate of candidates) {
    if (!isCurrentishStatus(candidate.status)) continue;
    const key = normalizeTitle(candidate.title);
    if (!key) continue;
    const group = titleGroups.get(key) ?? [];
    group.push(candidate);
    titleGroups.set(key, group);
  }

  const mergeMemoryIds = new Set<string>();
  for (const pair of mergePairs) {
    mergeMemoryIds.add(pair.keeperId);
    mergeMemoryIds.add(pair.duplicateId);
  }

  return [...titleGroups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => [...group].sort(sortForProactiveConsolidation))
    .flatMap((group) => {
      const distinctBodies = new Set(group.map((item) => normalizeContent(item.content)));
      const hasReviewedMemory = group.some((item) => item.status !== 'candidate');
      const fullyCoveredByMerge = group.every((item) => mergeMemoryIds.has(item.id));
      if (distinctBodies.size <= 1 && !hasReviewedMemory) {
        return [];
      }
      if (fullyCoveredByMerge && !hasReviewedMemory) {
        return [];
      }
      return [
        {
          title: group[0]?.title ?? 'untitled',
          reason:
            distinctBodies.size > 1
              ? 'same-title-divergent-content'
              : 'same-title-reviewed-history',
          memoryIds: group.map((item) => item.id),
          statuses: group.map((item) => item.status),
          recordedAts: group.map((item) => item.recordedAt ?? ''),
        } satisfies ProactiveConsolidationConflict,
      ];
    })
    .sort((left, right) => {
      const byTitle = normalizeTitle(left.title).localeCompare(normalizeTitle(right.title));
      if (byTitle !== 0) return byTitle;
      return left.memoryIds.join(',').localeCompare(right.memoryIds.join(','));
    });
}

function proactiveStopResult(input: {
  scannedPool: ProactiveConsolidationCandidate[];
  mergeCandidates?: ConsolidationPair[];
  mergeCandidatesTotal?: number;
  candidateConflicts?: ProactiveConsolidationConflict[];
  candidateConflictsTotal?: number;
  stopReason: ProactiveConsolidationStopReason;
  exhausted: boolean;
}): ProactiveConsolidationPlan {
  return {
    rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
    scanned: input.scannedPool.length,
    inputMemoryIds: input.scannedPool.map((item) => item.id),
    mergeCandidates: input.mergeCandidates ?? [],
    mergeCandidatesTotal: input.mergeCandidatesTotal ?? input.mergeCandidates?.length ?? 0,
    candidateConflicts: input.candidateConflicts ?? [],
    candidateConflictsTotal:
      input.candidateConflictsTotal ?? input.candidateConflicts?.length ?? 0,
    stopReason: input.stopReason,
    exhausted: input.exhausted,
    verifiedWrites: 0,
  };
}

/**
 * Plan near-duplicate consolidations among candidate memories.
 * Prefers exact normalized title matches, then embedding cosine >= threshold.
 */
export async function planCandidateConsolidations(
  candidates: ConsolidateCandidate[],
  options?: { similarityThreshold?: number; embedEngine?: string },
): Promise<ConsolidationPair[]> {
  const threshold = options?.similarityThreshold ?? 0.92;
  const pool = candidates.filter((c) => c.status === 'candidate');
  if (pool.length < 2) return [];

  const byTitle = new Map<string, ConsolidateCandidate[]>();
  for (const item of pool) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    const list = byTitle.get(key) ?? [];
    list.push(item);
    byTitle.set(key, list);
  }

  const pairs: ConsolidationPair[] = [];
  const used = new Set<string>();

  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      (b.recordedAt ?? '').localeCompare(a.recordedAt ?? ''),
    );
    const keeper = sorted[0]!;
    for (const dup of sorted.slice(1)) {
      if (used.has(dup.id) || used.has(keeper.id)) continue;
      pairs.push({
        keeperId: keeper.id,
        duplicateId: dup.id,
        score: 1,
        reason: 'exact-title',
      });
      used.add(dup.id);
    }
  }

  const remaining = pool.filter((c) => !used.has(c.id));
  if (remaining.length < 2) return pairs;

  const adapter = createEmbeddingAdapter(options?.embedEngine);
  const vectors: number[][] = [];
  for (const item of remaining) {
    if (item.embedding && item.embedding.length > 0) {
      vectors.push(item.embedding);
    } else {
      const { vectors: embedded } = await adapter.embed({
        texts: [`${item.title}\n${item.content}`],
      });
      vectors.push(embedded[0] ?? []);
    }
  }

  for (let i = 0; i < remaining.length; i += 1) {
    const left = remaining[i]!;
    if (used.has(left.id)) continue;
    for (let j = i + 1; j < remaining.length; j += 1) {
      const right = remaining[j]!;
      if (used.has(right.id)) continue;
      const score = cosineSimilarity(vectors[i] ?? [], vectors[j] ?? []);
      if (score < threshold) continue;
      const keeper =
        (left.recordedAt ?? '') >= (right.recordedAt ?? '') ? left : right;
      const duplicate = keeper.id === left.id ? right : left;
      pairs.push({
        keeperId: keeper.id,
        duplicateId: duplicate.id,
        score,
        reason: 'embed-similarity',
      });
      used.add(duplicate.id);
    }
  }

  return pairs;
}

export async function planProactiveConsolidation(
  candidates: ProactiveConsolidationCandidate[],
  options?: {
    similarityThreshold?: number;
    embedEngine?: string;
    scanLimit?: number;
    maxMerges?: number;
    maxConflicts?: number;
    maxTimeMs?: number;
    now?: () => number;
  },
): Promise<ProactiveConsolidationPlan> {
  const scanLimit = Math.min(
    Math.max(Math.trunc(options?.scanLimit ?? 100), 1),
    500,
  );
  const maxMerges = Math.min(
    Math.max(Math.trunc(options?.maxMerges ?? 12), 0),
    100,
  );
  const maxConflicts = Math.min(
    Math.max(Math.trunc(options?.maxConflicts ?? 12), 0),
    100,
  );
  const maxTimeMs = Math.min(
    Math.max(Math.trunc(options?.maxTimeMs ?? 1_500), 1),
    30_000,
  );
  const now = options?.now ?? (() => Date.now());
  const startedAt = now();

  const sorted = [...candidates].sort(sortForProactiveConsolidation);
  const scannedPool = sorted.slice(0, scanLimit);

  if (now() - startedAt > maxTimeMs) {
    return proactiveStopResult({
      scannedPool,
      stopReason: 'max_time_ms',
      exhausted: true,
    });
  }

  const mergeCandidatesAll = await planCandidateConsolidations(scannedPool, {
    similarityThreshold: options?.similarityThreshold,
    embedEngine: options?.embedEngine,
  });

  if (now() - startedAt > maxTimeMs) {
    return proactiveStopResult({
      scannedPool,
      mergeCandidates: mergeCandidatesAll.slice(0, maxMerges),
      mergeCandidatesTotal: mergeCandidatesAll.length,
      stopReason: 'max_time_ms',
      exhausted: true,
    });
  }

  const candidateConflictsAll = buildConflictCandidates(scannedPool, mergeCandidatesAll);

  if (now() - startedAt > maxTimeMs) {
    return proactiveStopResult({
      scannedPool,
      mergeCandidates: mergeCandidatesAll.slice(0, maxMerges),
      mergeCandidatesTotal: mergeCandidatesAll.length,
      candidateConflicts: candidateConflictsAll.slice(0, maxConflicts),
      candidateConflictsTotal: candidateConflictsAll.length,
      stopReason: 'max_time_ms',
      exhausted: true,
    });
  }

  const mergeCandidates = mergeCandidatesAll.slice(0, maxMerges);
  const candidateConflicts = candidateConflictsAll.slice(0, maxConflicts);
  const stopReason: ProactiveConsolidationStopReason =
    sorted.length > scanLimit
      ? 'max_records'
      : mergeCandidatesAll.length > mergeCandidates.length
        ? 'max_merges'
        : candidateConflictsAll.length > candidateConflicts.length
          ? 'max_conflicts'
          : 'completed';

  return proactiveStopResult({
    scannedPool,
    mergeCandidates,
    mergeCandidatesTotal: mergeCandidatesAll.length,
    candidateConflicts,
    candidateConflictsTotal: candidateConflictsAll.length,
    stopReason,
    exhausted: stopReason !== 'completed',
  });
}

export function buildProactiveConsolidationReason(input: {
  runId: string;
  pairReason: string;
  rulesVersion?: string;
}): string {
  const rulesVersion =
    input.rulesVersion ?? PROACTIVE_CONSOLIDATION_RULES_VERSION;
  return `consolidation.proactive ${rulesVersion} run ${input.runId}: ${input.pairReason}`;
}

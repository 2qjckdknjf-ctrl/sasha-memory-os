import {
  filterCurrentMemories,
  type MemoryRecord,
  type MemoryStatus,
} from '@memory-os/domain';
import {
  cosineSimilarity,
  createEmbeddingAdapter,
} from './embeddings.js';

export const packageName = 'retrieval' as const;
export * from './embeddings.js';
export * from './consolidate.js';
export * from './extraction.js';

/** Classic RRF constant (Cormack et al.). */
export const RRF_K = 60;

export interface SearchHit {
  memory: MemoryRecord;
  score: number;
  reason: string;
}

export type SearchTemporalOptions = {
  recordedAfter?: string;
  recordedBefore?: string;
};

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function recordedAtOf(memory: {
  recordedAt?: string | null;
  recorded_at?: string | null;
}): string | null {
  return memory.recordedAt ?? memory.recorded_at ?? null;
}

export function inRecordedWindow(
  recordedAt: string | null | undefined,
  options?: SearchTemporalOptions,
): boolean {
  if (!options?.recordedAfter && !options?.recordedBefore) return true;
  if (!recordedAt) return false;
  const t = Date.parse(recordedAt);
  if (Number.isNaN(t)) return false;
  if (options.recordedAfter) {
    const after = Date.parse(options.recordedAfter);
    if (!Number.isNaN(after) && t < after) return false;
  }
  if (options.recordedBefore) {
    const before = Date.parse(options.recordedBefore);
    if (!Number.isNaN(before) && t > before) return false;
  }
  return true;
}

/** Status → mild ranking multiplier (source / review authority). */
export function authorityMultiplier(status?: string | null): number {
  switch (status as MemoryStatus | undefined) {
    case 'verified':
      return 1.15;
    case 'active':
      return 1.08;
    case 'candidate':
      return 1.0;
    case 'disputed':
      return 0.7;
    case 'superseded':
    case 'retracted':
    case 'deleted':
      return 0.4;
    default:
      return 1.0;
  }
}

/**
 * Reciprocal Rank Fusion over already-ranked lists.
 * `idOf` must be stable per document across lists.
 */
export function fuseRanksRrf<T>(
  rankedLists: T[][],
  options?: {
    k?: number;
    idOf: (item: T) => string;
  },
): Array<{ id: string; score: number; item: T }> {
  const k = options?.k ?? RRF_K;
  if (!options?.idOf) {
    throw new Error('fuseRanksRrf requires idOf');
  }
  const scores = new Map<string, { score: number; item: T }>();
  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const id = options.idOf(item);
      const add = 1 / (k + index + 1);
      const prev = scores.get(id);
      if (prev) {
        prev.score += add;
      } else {
        scores.set(id, { score: add, item });
      }
    });
  }
  return [...scores.entries()]
    .map(([id, row]) => ({ id, score: row.score, item: row.item }))
    .sort((a, b) => b.score - a.score);
}

/** Structured + naive FTS stub. */
export function searchMemories(
  records: MemoryRecord[],
  query: string,
  options?: {
    includeHistory?: boolean;
    projectId?: string;
  } & SearchTemporalOptions,
): SearchHit[] {
  const tokens = tokenize(query);
  const pool = options?.includeHistory
    ? records
    : filterCurrentMemories(records);

  return pool
    .map((memory) => {
      if (options?.projectId && memory.projectId !== options.projectId) {
        return null;
      }
      if (!inRecordedWindow(memory.recordedAt, options)) {
        return null;
      }
      const auth = authorityMultiplier(memory.status);
      if (tokens.length === 0) {
        return {
          memory,
          score: memory.importance * memory.confidence * auth,
          reason: 'structured+text',
        } satisfies SearchHit;
      }
      const haystack = `${memory.title}\n${memory.content}`.toLowerCase();
      const matched = tokens.filter((token) => haystack.includes(token));
      if (matched.length === 0) return null;
      // Prefer covering more query tokens; still accept partial multi-word hits.
      const coverage = matched.length / tokens.length;
      if (coverage < 0.5 && tokens.length > 1) return null;
      return {
        memory,
        score:
          memory.importance *
          memory.confidence *
          auth *
          (0.5 + coverage / 2),
        reason: 'structured+text',
      } satisfies SearchHit;
    })
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((a, b) => b.score - a.score);
}

export type HybridHitLike = {
  memory: {
    id?: string | null;
    title?: string | null;
    content?: string | null;
    memoryType?: string | null;
    memory_type?: string | null;
    status?: string | null;
    recordedAt?: string | null;
    recorded_at?: string | null;
    supersededBy?: string | null;
    superseded_by?: string | null;
    embedding?: number[] | null;
    embedding_vector?: number[] | string | null;
  };
  score: number;
  reason?: string;
};

function asNumberVector(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((n) => typeof n === 'number')) {
    return value as number[];
  }
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
        return parsed as number[];
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function extractStoredEmbedding(memory: HybridHitLike['memory']): number[] | null {
  return (
    asNumberVector(memory.embedding) ?? asNumberVector(memory.embedding_vector)
  );
}

function hitDocId<T extends HybridHitLike>(hit: T, index: number): string {
  return String(hit.memory.id ?? `idx:${index}`);
}

export function filterHitsTemporal<T extends HybridHitLike>(
  hits: T[],
  options?: SearchTemporalOptions,
): T[] {
  if (!options?.recordedAfter && !options?.recordedBefore) return hits;
  return hits.filter((hit) =>
    inRecordedWindow(recordedAtOf(hit.memory), options),
  );
}

/** Pack ranked hits into a citation-aware context block for agents. */
export function packSearchContext(
  hits: HybridHitLike[],
  options?: { maxChars?: number; maxItems?: number },
): {
  text: string;
  citations: Array<{
    index: number;
    memoryId: string | null;
    title: string;
    score: number;
  }>;
  truncated: boolean;
  packedCount: number;
} {
  const maxChars = options?.maxChars ?? 4_000;
  const maxItems = options?.maxItems ?? 12;
  const citations: Array<{
    index: number;
    memoryId: string | null;
    title: string;
    score: number;
  }> = [];
  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  for (let i = 0; i < hits.length && citations.length < maxItems; i += 1) {
    const hit = hits[i]!;
    const title = String(hit.memory.title ?? 'untitled').trim() || 'untitled';
    const body = String(hit.memory.content ?? '').trim();
    const prefix = `[${citations.length + 1}] ${title}\n`;
    const sep = parts.length > 0 ? 2 : 0;
    const room = maxChars - used - sep - prefix.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    let snippet = body;
    if (snippet.length > room) {
      snippet = `${snippet.slice(0, Math.max(0, room - 1))}…`;
      truncated = true;
    }
    const block = `${prefix}${snippet}`;
    parts.push(block);
    used += sep + block.length;
    citations.push({
      index: citations.length + 1,
      memoryId: hit.memory.id ? String(hit.memory.id) : null,
      title,
      score: Number(hit.score),
    });
    if (truncated) break;
  }

  if (citations.length < hits.length) truncated = true;

  return {
    text: parts.join('\n\n'),
    citations,
    truncated,
    packedCount: citations.length,
  };
}

/** Embed title+content for persistence after capture/ingest. */
export async function embedMemoryText(
  title: string,
  content: string,
  options?: { embedEngine?: string },
): Promise<{ engine: string; dimensions: number; vector: number[] }> {
  const adapter = createEmbeddingAdapter(options?.embedEngine);
  const { engine, dimensions, vectors } = await adapter.embed({
    texts: [`${title}\n${content}`],
  });
  return {
    engine,
    dimensions,
    vector: vectors[0] ?? [],
  };
}

/**
 * Fuse lexical/RPC order with embedding cosine order via RRF, then authority.
 * Works for MemoryRecord hits or Supabase JSON rows.
 */
export async function rerankHitsHybrid<T extends HybridHitLike>(
  hits: T[],
  query: string,
  options?: {
    embedEngine?: string;
    reason?: string;
  } & SearchTemporalOptions,
): Promise<T[]> {
  const scoped = filterHitsTemporal(hits, options);
  if (scoped.length === 0 || !query.trim()) {
    return scoped;
  }

  const adapter = createEmbeddingAdapter(options?.embedEngine);
  const stored = scoped.map((hit) => extractStoredEmbedding(hit.memory));
  const useStored = stored.every((vec) => vec !== null && vec.length > 0);

  let similarities: number[];
  let defaultReason: string;
  if (useStored) {
    const { vectors } = await adapter.embed({ texts: [query] });
    const queryVec = vectors[0] ?? [];
    similarities = stored.map((vec) =>
      Math.max(0, cosineSimilarity(queryVec, vec ?? [])),
    );
    defaultReason = 'hybrid:rpc+rrf';
  } else {
    const texts = [
      query,
      ...scoped.map(
        (hit) => `${hit.memory.title ?? ''}\n${hit.memory.content ?? ''}`,
      ),
    ];
    const { vectors } = await adapter.embed({ texts });
    const queryVec = vectors[0] ?? [];
    similarities = scoped.map((_, index) =>
      Math.max(0, cosineSimilarity(queryVec, vectors[index + 1] ?? [])),
    );
    defaultReason = 'hybrid:rrf';
  }

  const indexByRef = new Map(scoped.map((hit, index) => [hit, index]));
  const lexicalOrder = [...scoped].sort(
    (a, b) => Number(b.score) - Number(a.score),
  );
  const vectorOrder = scoped
    .map((hit, index) => ({ hit, sim: similarities[index] ?? 0 }))
    .sort((a, b) => b.sim - a.sim)
    .map((row) => row.hit);

  const fused = fuseRanksRrf([lexicalOrder, vectorOrder], {
    idOf: (hit) => hitDocId(hit, indexByRef.get(hit) ?? 0),
  });

  const reason = options?.reason ?? defaultReason;
  const byId = new Map(fused.map((row) => [row.id, row]));
  // Authority already shapes lexical/SQL ranks; RRF fuses lists without
  // re-multiplying status so verified/active stay favored via rank position.
  return scoped
    .map((hit, index) => {
      const id = hitDocId(hit, index);
      const rrf = byId.get(id)?.score ?? 0;
      const sim = similarities[index] ?? 0;
      return {
        ...hit,
        // Readable score: RRF mass + mild cosine cue for ties.
        score: rrf + sim * 0.01,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Lexical candidates fused with embedding ranks via RRF (WP-07 / M5). */
export async function searchMemoriesHybrid(
  records: MemoryRecord[],
  query: string,
  options?: {
    includeHistory?: boolean;
    projectId?: string;
    embedEngine?: string;
  } & SearchTemporalOptions,
): Promise<SearchHit[]> {
  const lexical = searchMemories(records, query, options);
  return rerankHitsHybrid(lexical, query, {
    embedEngine: options?.embedEngine,
    reason: 'hybrid:rrf',
    recordedAfter: options?.recordedAfter,
    recordedBefore: options?.recordedBefore,
  });
}

export const AGENTIC_RETRIEVAL_TOOL_ALLOWLIST = ['memory.search'] as const;

export type AgenticRetrievalTool =
  (typeof AGENTIC_RETRIEVAL_TOOL_ALLOWLIST)[number];

export type AgenticRetrievalOutcome =
  | 'answered'
  | 'not_enough_data'
  | 'budget_exhausted';

export type AgenticRetrievalStopReason =
  | 'enough_evidence'
  | 'not_enough_data'
  | 'max_steps'
  | 'max_time_ms'
  | 'max_tokens'
  | 'max_cost_usd';

export type AgenticRetrievalPhase =
  | 'initial'
  | 'evidence'
  | 'timeline'
  | 'conflict_check';

export type AgenticRetrievalHopKind =
  | 'related_evidence'
  | 'timeline'
  | 'supersession';

export type AgenticRetrievalBudget = {
  maxSteps: number;
  maxTimeMs: number;
  maxTokens: number;
  maxCostUsd: number;
  minEvidenceHits: number;
};

export type AgenticRetrievalBudgetUsage = AgenticRetrievalBudget & {
  usedSteps: number;
  usedTimeMs: number;
  usedTokens: number;
  usedCostUsd: number;
};

export type AgenticRetrievalTraceHit = {
  memoryId: string | null;
  title: string;
  status: string | null;
  projectId: string | null;
  score: number;
};

export type AgenticRetrievalTraceStep = {
  step: number;
  phase: AgenticRetrievalPhase;
  tool: AgenticRetrievalTool;
  query: string;
  includeHistory: boolean;
  recordedAfter?: string;
  recordedBefore?: string;
  hitCount: number;
  scopeFilteredCount: number;
  elapsedMs: number;
  tokensEstimated: number;
  costEstimatedUsd: number;
  topHits: AgenticRetrievalTraceHit[];
  hop: {
    index: number;
    kind: AgenticRetrievalHopKind;
    groundedByMemoryIds: string[];
    groundedByTitles: string[];
  } | null;
};

export type AgenticRetrievalConflict = {
  memoryId: string | null;
  title: string;
  status: string;
  score: number;
};

export type AgenticRetrievalResult<T extends HybridHitLike = HybridHitLike> = {
  hits: T[];
  ranking: 'hybrid-rrf';
  context: ReturnType<typeof packSearchContext>;
  outcome: AgenticRetrievalOutcome;
  stopReason: AgenticRetrievalStopReason;
  writeActionsAttempted: 0;
  toolAllowlist: readonly AgenticRetrievalTool[];
  budget: AgenticRetrievalBudgetUsage;
  trace: {
    projectId: string;
    query: string;
    steps: AgenticRetrievalTraceStep[];
  };
  conflicts: AgenticRetrievalConflict[];
};

export type AgenticSearchRunner<T extends HybridHitLike> = (input: {
  query: string;
  projectId: string;
  includeHistory: boolean;
  recordedAfter?: string;
  recordedBefore?: string;
}) => Promise<T[]>;

const DEFAULT_AGENTIC_RETRIEVAL_BUDGET: AgenticRetrievalBudget = {
  maxSteps: 4,
  maxTimeMs: 1_500,
  maxTokens: 4_000,
  maxCostUsd: 0.01,
  minEvidenceHits: 2,
};

const AGENTIC_RETRIEVAL_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const CONFLICTING_MEMORY_STATUSES = new Set([
  'disputed',
  'superseded',
  'retracted',
  'deleted',
]);

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampDecimal(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

export function normalizeAgenticRetrievalBudget(
  budget?: Partial<{
    maxSteps: number;
    maxTimeMs: number;
    maxTokens: number;
    maxCostUsd: number;
    minEvidenceHits: number;
  }>,
): AgenticRetrievalBudget {
  return {
    maxSteps: clampInteger(budget?.maxSteps, DEFAULT_AGENTIC_RETRIEVAL_BUDGET.maxSteps, 1, 4),
    maxTimeMs: clampInteger(
      budget?.maxTimeMs,
      DEFAULT_AGENTIC_RETRIEVAL_BUDGET.maxTimeMs,
      100,
      10_000,
    ),
    maxTokens: clampInteger(
      budget?.maxTokens,
      DEFAULT_AGENTIC_RETRIEVAL_BUDGET.maxTokens,
      128,
      20_000,
    ),
    maxCostUsd: Number(
      clampDecimal(
        budget?.maxCostUsd,
        DEFAULT_AGENTIC_RETRIEVAL_BUDGET.maxCostUsd,
        0.0001,
        1,
      ).toFixed(6),
    ),
    minEvidenceHits: clampInteger(
      budget?.minEvidenceHits,
      DEFAULT_AGENTIC_RETRIEVAL_BUDGET.minEvidenceHits,
      1,
      5,
    ),
  };
}

function hitProjectIdOf(hit: HybridHitLike): string | null {
  const memory = hit.memory as HybridHitLike['memory'] & {
    projectId?: string | null;
    project_id?: string | null;
  };
  return memory.projectId ?? memory.project_id ?? null;
}

function hitStatusOf(hit: HybridHitLike): string | null {
  return typeof hit.memory.status === 'string' ? hit.memory.status : null;
}

function hitTitleOf(hit: HybridHitLike): string {
  return String(hit.memory.title ?? 'untitled').trim() || 'untitled';
}

function hitMemoryTypeOf(hit: HybridHitLike): string | null {
  const memory = hit.memory as HybridHitLike['memory'] & {
    memoryType?: string | null;
    memory_type?: string | null;
  };
  return memory.memoryType ?? memory.memory_type ?? null;
}

function hitSupersededByOf(hit: HybridHitLike): string | null {
  const memory = hit.memory as HybridHitLike['memory'] & {
    supersededBy?: string | null;
    superseded_by?: string | null;
  };
  return memory.supersededBy ?? memory.superseded_by ?? null;
}

function hitIdOf(hit: HybridHitLike, index: number): string {
  return String(hit.memory.id ?? `idx:${index}`);
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 1 : Math.max(1, Math.ceil(trimmed.length / 4));
}

function estimateSearchCostUsd(tokensEstimated: number): number {
  return Number((0.00005 + tokensEstimated * 0.0000005).toFixed(6));
}

function estimateHitTokens(hit: HybridHitLike): number {
  const title = hitTitleOf(hit);
  const content = String(hit.memory.content ?? '').slice(0, 320);
  return estimateTokens(`${title}\n${content}`);
}

function buildTraceHits<T extends HybridHitLike>(hits: T[]): AgenticRetrievalTraceHit[] {
  return hits.slice(0, 3).map((hit) => ({
    memoryId: hit.memory.id ? String(hit.memory.id) : null,
    title: hitTitleOf(hit),
    status: hitStatusOf(hit),
    projectId: hitProjectIdOf(hit),
    score: Number(hit.score),
  }));
}

function scopeHitsToProject<T extends HybridHitLike>(
  hits: T[],
  projectId: string,
): { hits: T[]; filteredCount: number } {
  const scoped = hits.filter((hit) => hitProjectIdOf(hit) === projectId);
  return {
    hits: scoped,
    filteredCount: Math.max(0, hits.length - scoped.length),
  };
}

function mergeHybridHits<T extends HybridHitLike>(lists: T[][]): T[] {
  const merged = new Map<string, T>();
  for (const list of lists) {
    list.forEach((hit, index) => {
      const id = hitIdOf(hit, index);
      const existing = merged.get(id);
      if (!existing || Number(hit.score) > Number(existing.score)) {
        merged.set(id, hit);
      }
    });
  }
  return [...merged.values()].sort((a, b) => Number(b.score) - Number(a.score));
}

function buildEvidenceRefinementQuery<T extends HybridHitLike>(
  query: string,
  hits: T[],
): string | null {
  const anchor = selectHopAnchorHit(hits);
  if (!anchor) {
    return null;
  }
  const relatedTypeHints =
    hitMemoryTypeOf(anchor) === 'decision'
      ? 'task fact'
      : hitMemoryTypeOf(anchor) === 'task'
        ? 'decision fact'
        : hitMemoryTypeOf(anchor) === 'fact'
          ? 'decision task'
          : 'decision task fact';
  return buildHopQuery(query, hits, relatedTypeHints);
}

function buildTimelineHopQuery<T extends HybridHitLike>(
  query: string,
  hits: T[],
): string | null {
  return buildHopQuery(query, hits, 'history timeline current previous');
}

function buildSupersessionHopQuery<T extends HybridHitLike>(
  query: string,
  hits: T[],
): string | null {
  const anchor = selectHopAnchorHit(hits);
  if (!anchor) {
    return null;
  }
  const qualifiers =
    hitSupersededByOf(anchor) ||
    CONFLICTING_MEMORY_STATUSES.has(hitStatusOf(anchor) ?? '')
      ? 'current superseded corrected replacement'
      : 'superseded corrected retracted disputed';
  return buildHopQuery(query, hits, qualifiers);
}

function selectHopAnchorHit<T extends HybridHitLike>(hits: T[]): T | null {
  const preferred = hits.find(
    (hit) => !CONFLICTING_MEMORY_STATUSES.has(hitStatusOf(hit) ?? ''),
  );
  return preferred ?? hits[0] ?? null;
}

function buildHopGrounding<T extends HybridHitLike>(hits: T[]): T[] {
  const seen = new Set<string>();
  const grounding: T[] = [];
  hits.forEach((hit, index) => {
    const id = hitIdOf(hit, index);
    if (seen.has(id) || grounding.length >= 2) {
      return;
    }
    seen.add(id);
    grounding.push(hit);
  });
  return grounding;
}

function buildHopQuery<T extends HybridHitLike>(
  query: string,
  hits: T[],
  suffix: string,
): string | null {
  const anchor = selectHopAnchorHit(hits);
  if (!anchor) {
    return null;
  }
  const salientTerms = buildSalientHopTerms(query, hits);
  const merged = joinDistinctQueryTokens([
    query,
    hitTitleOf(anchor),
    salientTerms.join(' '),
    suffix,
  ]);
  return merged.trim() ? merged : null;
}

function buildSalientHopTerms<T extends HybridHitLike>(
  query: string,
  hits: T[],
): string[] {
  const queryTokens = new Set(tokenize(query));
  const counts = new Map<string, number>();
  for (const hit of hits.slice(0, 3)) {
    const searchable = `${hitTitleOf(hit)} ${String(hit.memory.content ?? '').slice(0, 180)}`;
    for (const token of tokenize(searchable)) {
      if (
        queryTokens.has(token) ||
        AGENTIC_RETRIEVAL_STOPWORDS.has(token) ||
        token.length < 3
      ) {
        continue;
      }
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 4)
    .map(([token]) => token);
}

function joinDistinctQueryTokens(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of parts) {
    for (const token of tokenize(part ?? '')) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      merged.push(token);
    }
  }
  return merged.join(' ');
}

function detectConflicts<T extends HybridHitLike>(hits: T[]): AgenticRetrievalConflict[] {
  return hits
    .filter((hit) => {
      const status = hitStatusOf(hit);
      return status ? CONFLICTING_MEMORY_STATUSES.has(status) : false;
    })
    .slice(0, 5)
    .map((hit) => ({
      memoryId: hit.memory.id ? String(hit.memory.id) : null,
      title: hitTitleOf(hit),
      status: hitStatusOf(hit) ?? 'unknown',
      score: Number(hit.score),
    }));
}

function hasEnoughEvidence<T extends HybridHitLike>(
  hits: T[],
  budget: AgenticRetrievalBudget,
): boolean {
  const eligible = hits.filter((hit) => !CONFLICTING_MEMORY_STATUSES.has(hitStatusOf(hit) ?? ''));
  return eligible.length >= budget.minEvidenceHits;
}

export async function runBoundedAgenticRetrieval<T extends HybridHitLike>(input: {
  query: string;
  projectId: string;
  search: AgenticSearchRunner<T>;
  budget?: Partial<{
    maxSteps: number;
    maxTimeMs: number;
    maxTokens: number;
    maxCostUsd: number;
    minEvidenceHits: number;
  }>;
  recordedAfter?: string;
  recordedBefore?: string;
  maxContextChars?: number;
  now?: () => number;
}): Promise<AgenticRetrievalResult<T>> {
  const budget = normalizeAgenticRetrievalBudget(input.budget);
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const steps: AgenticRetrievalTraceStep[] = [];
  const hitLists: T[][] = [];
  const seenQueries = new Set<string>();
  let usedTokens = 0;
  let usedCostUsd = 0;
  let hopIndex = 0;
  let stopReason: AgenticRetrievalStopReason = 'not_enough_data';
  let outcome: AgenticRetrievalOutcome = 'not_enough_data';

  const phasePlan: Array<{
    phase: AgenticRetrievalPhase;
    hopKind: AgenticRetrievalHopKind | null;
    buildQuery: (mergedHits: T[]) => string | null;
    includeHistory: boolean;
  }> = [
    {
      phase: 'initial',
      hopKind: null,
      buildQuery: () => input.query.trim(),
      includeHistory: false,
    },
    {
      phase: 'evidence',
      hopKind: 'related_evidence',
      buildQuery: (mergedHits) => buildEvidenceRefinementQuery(input.query, mergedHits),
      includeHistory: false,
    },
    {
      phase: 'timeline',
      hopKind: 'timeline',
      buildQuery: (mergedHits) => buildTimelineHopQuery(input.query, mergedHits),
      includeHistory: true,
    },
    {
      phase: 'conflict_check',
      hopKind: 'supersession',
      buildQuery: (mergedHits) => buildSupersessionHopQuery(input.query, mergedHits),
      includeHistory: true,
    },
  ];
  const plannedStepCount = Math.min(phasePlan.length, budget.maxSteps);

  for (const phasePlanEntry of phasePlan) {
    if (steps.length >= budget.maxSteps) {
      stopReason = 'max_steps';
      outcome = 'budget_exhausted';
      break;
    }
    if (now() - startedAt >= budget.maxTimeMs) {
      stopReason = 'max_time_ms';
      outcome = 'budget_exhausted';
      break;
    }
    if (usedTokens >= budget.maxTokens) {
      stopReason = 'max_tokens';
      outcome = 'budget_exhausted';
      break;
    }
    if (usedCostUsd >= budget.maxCostUsd) {
      stopReason = 'max_cost_usd';
      outcome = 'budget_exhausted';
      break;
    }

    const mergedHitsBeforeStep = mergeHybridHits(hitLists);
    const query = phasePlanEntry.buildQuery(mergedHitsBeforeStep)?.trim() ?? '';
    if (!query) {
      continue;
    }
    const grounding = phasePlanEntry.hopKind
      ? buildHopGrounding(mergedHitsBeforeStep)
      : [];
    const queryKey = `${phasePlanEntry.includeHistory ? 'history' : 'current'}:${query.toLowerCase()}`;
    if (seenQueries.has(queryKey)) {
      continue;
    }
    seenQueries.add(queryKey);

    const stepStartedAt = now();
    const rawHits = await input.search({
      query,
      projectId: input.projectId,
      includeHistory: phasePlanEntry.includeHistory,
      recordedAfter: input.recordedAfter,
      recordedBefore: input.recordedBefore,
    });
    const elapsedMs = Math.max(0, now() - stepStartedAt);
    const scoped = scopeHitsToProject(rawHits, input.projectId);
    hitLists.push(scoped.hits);

    const tokensEstimated =
      estimateTokens(query) +
      scoped.hits.slice(0, 3).reduce((sum, hit) => sum + estimateHitTokens(hit), 0);
    const costEstimatedUsd = estimateSearchCostUsd(tokensEstimated);
    usedTokens += tokensEstimated;
    usedCostUsd = Number((usedCostUsd + costEstimatedUsd).toFixed(6));

    steps.push({
      step: steps.length + 1,
      phase: phasePlanEntry.phase,
      tool: 'memory.search',
      query,
      includeHistory: phasePlanEntry.includeHistory,
      recordedAfter: input.recordedAfter,
      recordedBefore: input.recordedBefore,
      hitCount: scoped.hits.length,
      scopeFilteredCount: scoped.filteredCount,
      elapsedMs,
      tokensEstimated,
      costEstimatedUsd,
      topHits: buildTraceHits(scoped.hits),
      hop: phasePlanEntry.hopKind
        ? {
            index: ++hopIndex,
            kind: phasePlanEntry.hopKind,
            groundedByMemoryIds: grounding.map((hit, index) =>
              hit.memory.id ? String(hit.memory.id) : hitIdOf(hit, index),
            ),
            groundedByTitles: grounding.map((hit) => hitTitleOf(hit)),
          }
        : null,
    });

    const mergedHitsAfterStep = mergeHybridHits(hitLists);
    if (steps.length === 1 && mergedHitsAfterStep.length === 0) {
      stopReason = 'not_enough_data';
      outcome = 'not_enough_data';
      break;
    }
  }

  const hits = mergeHybridHits(hitLists);
  const conflicts = detectConflicts(hits);
  const enoughEvidence = hasEnoughEvidence(hits, budget);
  const finishedAllPlannedWork = steps.length >= plannedStepCount;

  if (enoughEvidence) {
    stopReason = 'enough_evidence';
    outcome = 'answered';
  } else if (outcome !== 'budget_exhausted') {
    if (stopReason !== 'not_enough_data' || steps.length > 0 || finishedAllPlannedWork) {
      stopReason = 'not_enough_data';
      outcome = 'not_enough_data';
    }
  }

  return {
    hits,
    ranking: 'hybrid-rrf',
    context: packSearchContext(hits, { maxChars: input.maxContextChars }),
    outcome,
    stopReason,
    writeActionsAttempted: 0,
    toolAllowlist: AGENTIC_RETRIEVAL_TOOL_ALLOWLIST,
    budget: {
      ...budget,
      usedSteps: steps.length,
      usedTimeMs: Math.max(0, now() - startedAt),
      usedTokens,
      usedCostUsd,
    },
    trace: {
      projectId: input.projectId,
      query: input.query,
      steps,
    },
    conflicts,
  };
}

export function projectContext(records: MemoryRecord[], projectId: string) {
  const current = filterCurrentMemories(
    records.filter((m) => m.projectId === projectId),
  );
  return {
    projectId,
    decisions: current.filter((m) => m.memoryType === 'decision'),
    tasks: current.filter((m) => m.memoryType === 'task'),
    facts: current.filter((m) => m.memoryType === 'fact'),
  };
}

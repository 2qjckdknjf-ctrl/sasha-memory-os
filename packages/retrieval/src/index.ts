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
    status?: string | null;
    recordedAt?: string | null;
    recorded_at?: string | null;
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

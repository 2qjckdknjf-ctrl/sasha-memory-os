import {
  filterCurrentMemories,
  type MemoryRecord,
} from '@memory-os/domain';
import {
  cosineSimilarity,
  createEmbeddingAdapter,
} from './embeddings.js';

export const packageName = 'retrieval' as const;
export * from './embeddings.js';
export * from './consolidate.js';

export interface SearchHit {
  memory: MemoryRecord;
  score: number;
  reason: string;
}

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** Structured + naive FTS stub. */
export function searchMemories(
  records: MemoryRecord[],
  query: string,
  options?: { includeHistory?: boolean; projectId?: string },
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
      if (tokens.length === 0) {
        return {
          memory,
          score: memory.importance * memory.confidence,
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
        score: memory.importance * memory.confidence * (0.5 + coverage / 2),
        reason: 'structured+text',
      } satisfies SearchHit;
    })
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((a, b) => b.score - a.score);
}

export type HybridHitLike = {
  memory: {
    title?: string | null;
    content?: string | null;
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

/** Re-rank lexical/RPC hits with embedding cosine (works for MemoryRecord or Supabase JSON). */
export async function rerankHitsHybrid<T extends HybridHitLike>(
  hits: T[],
  query: string,
  options?: { embedEngine?: string; reason?: string },
): Promise<T[]> {
  if (hits.length === 0 || !query.trim()) return hits;

  const adapter = createEmbeddingAdapter(options?.embedEngine);
  const stored = hits.map((hit) => extractStoredEmbedding(hit.memory));
  const useStored = stored.every((vec) => vec !== null && vec.length > 0);

  if (useStored) {
    const { vectors } = await adapter.embed({ texts: [query] });
    const queryVec = vectors[0] ?? [];
    const reason = options?.reason ?? 'hybrid:rpc+stored-embed';
    return hits
      .map((hit, index) => {
        const sim = cosineSimilarity(queryVec, stored[index] ?? []);
        return {
          ...hit,
          score: Number(hit.score) * 0.7 + Math.max(0, sim) * 0.3,
          reason,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  const texts = [
    query,
    ...hits.map((hit) => `${hit.memory.title ?? ''}\n${hit.memory.content ?? ''}`),
  ];
  const { vectors } = await adapter.embed({ texts });
  const queryVec = vectors[0] ?? [];
  const reason = options?.reason ?? 'hybrid:text+embed';

  return hits
    .map((hit, index) => {
      const sim = cosineSimilarity(queryVec, vectors[index + 1] ?? []);
      return {
        ...hit,
        score: Number(hit.score) * 0.7 + Math.max(0, sim) * 0.3,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Lexical candidates re-ranked with embedding cosine (WP-07 hybrid alpha). */
export async function searchMemoriesHybrid(
  records: MemoryRecord[],
  query: string,
  options?: { includeHistory?: boolean; projectId?: string; embedEngine?: string },
): Promise<SearchHit[]> {
  const lexical = searchMemories(records, query, options);
  return rerankHitsHybrid(lexical, query, {
    embedEngine: options?.embedEngine,
    reason: 'hybrid:text+embed',
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

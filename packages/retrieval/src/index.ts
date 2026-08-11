import {
  filterCurrentMemories,
  type MemoryRecord,
} from '@memory-os/domain';

export const packageName = 'retrieval' as const;
export * from './embeddings.js';

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

/** Structured + naive FTS stub (hybrid ranking comes in later WP-07). */
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

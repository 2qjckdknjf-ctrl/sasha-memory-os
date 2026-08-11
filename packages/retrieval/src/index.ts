import {
  filterCurrentMemories,
  type MemoryRecord,
} from '@memory-os/domain';

export const packageName = 'retrieval' as const;

export interface SearchHit {
  memory: MemoryRecord;
  score: number;
  reason: string;
}

/** Structured + naive FTS stub (hybrid ranking comes in later WP-07). */
export function searchMemories(
  records: MemoryRecord[],
  query: string,
  options?: { includeHistory?: boolean; projectId?: string },
): SearchHit[] {
  const normalized = query.trim().toLowerCase();
  const pool = options?.includeHistory
    ? records
    : filterCurrentMemories(records);

  return pool
    .filter((m) => {
      if (options?.projectId && m.projectId !== options.projectId) return false;
      if (!normalized) return true;
      return (
        m.title.toLowerCase().includes(normalized) ||
        m.content.toLowerCase().includes(normalized)
      );
    })
    .map((memory) => ({
      memory,
      score: memory.importance * memory.confidence,
      reason: 'structured+text',
    }))
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

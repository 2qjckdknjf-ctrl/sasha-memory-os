export type QueryEmbedding = {
  vector: number[];
  engine: string;
};

type CacheEntry = {
  expiresAt: number;
  value: Promise<QueryEmbedding>;
};

export type QueryEmbeddingCache = {
  getOrLoad(key: string, loader: () => Promise<QueryEmbedding>): Promise<QueryEmbedding>;
  size(): number;
};

/**
 * Small isolate-local cache for query embeddings. It collapses concurrent
 * identical loads and bounds both lifetime and entry count. Keys never leave
 * the Edge isolate and are never included in logs or responses.
 */
export function createQueryEmbeddingCache(input?: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}): QueryEmbeddingCache {
  const ttlMs = input?.ttlMs ?? 5 * 60_000;
  const maxEntries = input?.maxEntries ?? 128;
  const now = input?.now ?? Date.now;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be positive");
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error("maxEntries must be a positive integer");
  }
  const entries = new Map<string, CacheEntry>();

  const removeExpired = (currentTime: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  };

  return {
    async getOrLoad(key, loader) {
      const currentTime = now();
      removeExpired(currentTime);
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        entries.set(key, cached);
        return await cached.value;
      }

      const value = loader();
      entries.set(key, { expiresAt: currentTime + ttlMs, value });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      try {
        return await value;
      } catch (error) {
        const entry = entries.get(key);
        if (entry?.value === value) entries.delete(key);
        throw error;
      }
    },
    size: () => entries.size,
  };
}

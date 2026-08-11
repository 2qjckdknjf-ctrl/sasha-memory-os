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

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
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

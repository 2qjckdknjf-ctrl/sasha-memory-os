import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  createEmbeddingAdapter,
  StubEmbeddingAdapter,
} from './embeddings.js';

describe('StubEmbeddingAdapter', () => {
  it('embeds deterministically and ranks similar text higher', async () => {
    const adapter = createEmbeddingAdapter('stub');
    expect(adapter).toBeInstanceOf(StubEmbeddingAdapter);
    const [query, near, far] = (
      await adapter.embed({
        texts: [
          'Memory Core ACL temporal model',
          'Memory Core ACL provenance',
          'unrelated cooking recipe pasta',
        ],
      })
    ).vectors;
    expect(cosineSimilarity(query!, near!)).toBeGreaterThan(
      cosineSimilarity(query!, far!),
    );
  });
});

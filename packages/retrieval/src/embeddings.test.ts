import { describe, expect, it, vi } from 'vitest';
import {
  cosineSimilarity,
  createEmbeddingAdapter,
  OpenAiEmbeddingAdapter,
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

describe('OpenAiEmbeddingAdapter', () => {
  it('posts texts and returns vectors without leaking the API key', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.2, 0.1] },
        ],
      }),
    );
    const adapter = new OpenAiEmbeddingAdapter({
      apiKey: 'sk-test-secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.embed({ texts: ['a', 'b'] });
    expect(result.engine).toBe('openai');
    expect(result.vectors).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('sk-test-secret');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as { body: string }).body,
    ) as { dimensions?: number };
    expect(body.dimensions).toBe(32);
  });

  it('throws in strict mode when openai key is missing', () => {
    const prevEngine = process.env.MEMORY_OS_EMBED_ENGINE;
    const prevKey = process.env.MEMORY_OS_OPENAI_API_KEY;
    const prevStrict = process.env.MEMORY_OS_EMBED_STRICT;
    process.env.MEMORY_OS_EMBED_ENGINE = 'openai';
    delete process.env.MEMORY_OS_OPENAI_API_KEY;
    process.env.MEMORY_OS_EMBED_STRICT = '1';
    try {
      expect(() => createEmbeddingAdapter('openai')).toThrow(/API_KEY/);
    } finally {
      if (prevEngine === undefined) delete process.env.MEMORY_OS_EMBED_ENGINE;
      else process.env.MEMORY_OS_EMBED_ENGINE = prevEngine;
      if (prevKey === undefined) delete process.env.MEMORY_OS_OPENAI_API_KEY;
      else process.env.MEMORY_OS_OPENAI_API_KEY = prevKey;
      if (prevStrict === undefined) delete process.env.MEMORY_OS_EMBED_STRICT;
      else process.env.MEMORY_OS_EMBED_STRICT = prevStrict;
    }
  });

  it('honors custom shortened dimensions', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: [{ index: 0, embedding: Array.from({ length: 64 }, () => 0.01) }],
      }),
    );
    const adapter = new OpenAiEmbeddingAdapter({
      apiKey: 'sk-test',
      dimensions: 64,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.embed({ texts: ['x'] });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]![1] as { body: string }).body,
    ) as { dimensions?: number };
    expect(body.dimensions).toBe(64);
  });
});

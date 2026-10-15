import { describe, expect, it, vi } from 'vitest';
import {
  createQueryEmbeddingCache,
  queryEmbeddingCacheKey,
} from '../../supabase/functions/memory-mcp/queryEmbeddingCache.js';

describe('M20.3 Edge query embedding cache', () => {
  it('uses a fixed-size digest instead of retaining query text in the cache key', async () => {
    const key = await queryEmbeddingCacheKey({
      engine: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 32,
      text: 'private owner query',
    });

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('private owner query');
  });

  it('collapses concurrent and repeated identical embedding loads', async () => {
    const loader = vi.fn(async () => ({ vector: [0.1, 0.2], engine: 'test' }));
    const cache = createQueryEmbeddingCache();

    const [first, second] = await Promise.all([
      cache.getOrLoad('model:32:query', loader),
      cache.getOrLoad('model:32:query', loader),
    ]);
    const third = await cache.getOrLoad('model:32:query', loader);

    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('expires old entries, evicts least-recently-used entries, and retries failures', async () => {
    let now = 1_000;
    const cache = createQueryEmbeddingCache({ ttlMs: 100, maxEntries: 2, now: () => now });
    const good = vi.fn(async () => ({ vector: [1], engine: 'test' }));

    await cache.getOrLoad('a', good);
    await cache.getOrLoad('b', good);
    await cache.getOrLoad('a', good);
    await cache.getOrLoad('c', good);
    expect(cache.size()).toBe(2);
    await cache.getOrLoad('b', good);
    expect(good).toHaveBeenCalledTimes(4);

    const failed = vi.fn(async () => {
      throw new Error('temporary provider error');
    });
    await expect(cache.getOrLoad('failure', failed)).rejects.toThrow('temporary provider error');
    await expect(cache.getOrLoad('failure', failed)).rejects.toThrow('temporary provider error');
    expect(failed).toHaveBeenCalledTimes(2);

    now += 101;
    await cache.getOrLoad('a', good);
    expect(good).toHaveBeenCalledTimes(5);
  });

  it('does not cache transient provider fallbacks', async () => {
    const cache = createQueryEmbeddingCache({
      cacheable: (value) => value.engine !== 'stub-hash-fallback',
    });
    const fallback = vi.fn(async () => ({ vector: [1], engine: 'stub-hash-fallback' }));

    await cache.getOrLoad('transient', fallback);
    await cache.getOrLoad('transient', fallback);

    expect(fallback).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(0);
  });
});

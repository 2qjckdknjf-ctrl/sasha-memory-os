import { describe, expect, it } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import { projectContext, searchMemories } from './index.js';

describe('retrieval stub', () => {
  it('finds seeded decision by text', () => {
    const store = createSeededStore();
    const hits = searchMemories([...store.memories.values()], 'Slice 01');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.memory.memoryType).toBe('decision');
  });

  it('matches multi-word queries by token coverage', () => {
    const store = createSeededStore();
    const hits = searchMemories(
      [...store.memories.values()],
      'demo slice kickoff audit',
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.memory.title).toMatch(/Slice/i);
  });

  it('hybrid search returns embed reason', async () => {
    const { searchMemoriesHybrid } = await import('./index.js');
    const store = createSeededStore();
    const hits = await searchMemoriesHybrid(
      [...store.memories.values()],
      'Slice 01',
    );
    expect(hits[0]?.reason).toBe('hybrid:text+embed');
  });

  it('reranks RPC-shaped hits for supabase path', async () => {
    const { rerankHitsHybrid } = await import('./index.js');
    const hits = await rerankHitsHybrid(
      [
        {
          memory: {
            title: 'Unrelated pasta',
            content: 'unrelated cooking recipe pasta',
          },
          score: 0.55,
          reason: 'structured+text',
        },
        {
          memory: {
            title: 'Memory Core ACL note',
            content: 'Memory Core ACL provenance',
          },
          score: 0.55,
          reason: 'structured+text',
        },
      ],
      'Memory Core ACL temporal model',
      { reason: 'hybrid:rpc+embed' },
    );
    expect(hits[0]?.memory.title).toMatch(/Memory Core/);
    expect(hits[0]?.reason).toBe('hybrid:rpc+embed');
    expect(hits).toHaveLength(2);
  });

  it('uses stored embeddings when present on RPC hits', async () => {
    const { createEmbeddingAdapter } = await import('./embeddings.js');
    const { rerankHitsHybrid } = await import('./index.js');
    const adapter = createEmbeddingAdapter('stub');
    const { vectors } = await adapter.embed({
      texts: [
        'unrelated cooking recipe pasta',
        'Memory Core ACL provenance',
      ],
    });
    const hits = await rerankHitsHybrid(
      [
        {
          memory: {
            title: 'Unrelated pasta',
            content: 'unrelated cooking recipe pasta',
            embedding: vectors[0],
          },
          score: 0.55,
        },
        {
          memory: {
            title: 'Memory Core ACL note',
            content: 'Memory Core ACL provenance',
            embedding: vectors[1],
          },
          score: 0.55,
        },
      ],
      'Memory Core ACL temporal model',
    );
    expect(hits[0]?.memory.title).toMatch(/Memory Core/);
    expect(hits[0]?.reason).toBe('hybrid:rpc+stored-embed');
  });

  it('builds project context', () => {
    const store = createSeededStore();
    const ctx = projectContext(
      [...store.memories.values()],
      '44444444-4444-4444-8444-444444444401',
    );
    expect(ctx.decisions.length).toBe(1);
  });
});

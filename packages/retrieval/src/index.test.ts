import { describe, expect, it } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import {
  authorityMultiplier,
  fuseRanksRrf,
  packSearchContext,
  projectContext,
  searchMemories,
} from './index.js';

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

  it('hybrid search returns RRF reason', async () => {
    const { searchMemoriesHybrid } = await import('./index.js');
    const store = createSeededStore();
    const hits = await searchMemoriesHybrid(
      [...store.memories.values()],
      'Slice 01',
    );
    expect(hits[0]?.reason).toBe('hybrid:rrf');
  });

  it('reranks RPC-shaped hits for supabase path', async () => {
    const { rerankHitsHybrid } = await import('./index.js');
    const hits = await rerankHitsHybrid(
      [
        {
          memory: {
            id: 'a',
            title: 'Unrelated pasta',
            content: 'unrelated cooking recipe pasta',
          },
          score: 0.55,
          reason: 'structured+text',
        },
        {
          memory: {
            id: 'b',
            title: 'Memory Core ACL note',
            content: 'Memory Core ACL provenance',
          },
          score: 0.55,
          reason: 'structured+text',
        },
      ],
      'Memory Core ACL temporal model',
      { reason: 'hybrid:rpc+rrf' },
    );
    expect(hits[0]?.memory.title).toMatch(/Memory Core/);
    expect(hits[0]?.reason).toBe('hybrid:rpc+rrf');
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
            id: 'a',
            title: 'Unrelated pasta',
            content: 'unrelated cooking recipe pasta',
            embedding: vectors[0],
          },
          score: 0.55,
        },
        {
          memory: {
            id: 'b',
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
    expect(hits[0]?.reason).toBe('hybrid:rpc+rrf');
  });

  it('fuses ranks with RRF', () => {
    const fused = fuseRanksRrf(
      [
        [{ id: 'b' }, { id: 'a' }],
        [{ id: 'b' }, { id: 'c' }],
      ],
      { idOf: (row) => row.id },
    );
    expect(fused[0]?.id).toBe('b');
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it('packs citations under a char budget', () => {
    const packed = packSearchContext(
      [
        {
          memory: { id: '1', title: 'One', content: 'alpha '.repeat(40) },
          score: 0.9,
        },
        {
          memory: { id: '2', title: 'Two', content: 'beta '.repeat(40) },
          score: 0.8,
        },
      ],
      { maxChars: 120 },
    );
    expect(packed.packedCount).toBe(1);
    expect(packed.truncated).toBe(true);
    expect(packed.citations[0]?.memoryId).toBe('1');
    expect(packed.text).toContain('[1] One');
  });

  it('filters by recorded window', () => {
    const store = createSeededStore();
    const all = searchMemories([...store.memories.values()], 'Slice');
    expect(all.length).toBeGreaterThan(0);
    const none = searchMemories([...store.memories.values()], 'Slice', {
      recordedAfter: '2099-01-01T00:00:00.000Z',
    });
    expect(none).toHaveLength(0);
  });

  it('ranks verified above candidate via authority', () => {
    expect(authorityMultiplier('verified')).toBeGreaterThan(
      authorityMultiplier('candidate'),
    );
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

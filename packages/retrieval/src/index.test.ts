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

  it('builds project context', () => {
    const store = createSeededStore();
    const ctx = projectContext(
      [...store.memories.values()],
      '44444444-4444-4444-8444-444444444401',
    );
    expect(ctx.decisions.length).toBe(1);
  });
});

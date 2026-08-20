import { describe, expect, it } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import {
  AGENTIC_RETRIEVAL_TOOL_ALLOWLIST,
  authorityMultiplier,
  fuseRanksRrf,
  packSearchContext,
  projectContext,
  runBoundedAgenticRetrieval,
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

  it('runs bounded agentic retrieval with step trace and scoped results', async () => {
    const targetProjectId = '44444444-4444-4444-8444-444444444401';
    const otherProjectId = '44444444-4444-4444-8444-444444444499';
    const calls: string[] = [];
    const result = await runBoundedAgenticRetrieval({
      query: 'Slice kickoff',
      projectId: targetProjectId,
      search: async ({ query, includeHistory }) => {
        calls.push(`${includeHistory ? 'history' : 'current'}:${query}`);
        if (query.includes('disputed superseded corrected retracted')) {
          return [
            {
              memory: {
                id: 'm-2',
                projectId: targetProjectId,
                title: 'Kickoff handoff note',
                content: 'Current evidence remains aligned.',
                status: 'active',
              },
              score: 0.82,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        if (includeHistory) {
          return [
            {
              memory: {
                id: 'm-1',
                projectId: targetProjectId,
                title: 'Slice kickoff decision',
                content: 'History confirms the kickoff decision.',
                status: 'verified',
              },
              score: 0.93,
              reason: 'hybrid:rpc+rrf',
            },
            {
              memory: {
                id: 'm-2',
                projectId: targetProjectId,
                title: 'Kickoff handoff note',
                content: 'Timeline evidence references the same slice.',
                status: 'active',
              },
              score: 0.81,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        if (query.includes('decision')) {
          return [
            {
              memory: {
                id: 'm-1',
                projectId: targetProjectId,
                title: 'Slice kickoff decision',
                content: 'Decision evidence for Slice kickoff.',
                status: 'verified',
              },
              score: 0.94,
              reason: 'hybrid:rpc+rrf',
            },
            {
              memory: {
                id: 'm-2',
                projectId: targetProjectId,
                title: 'Kickoff handoff note',
                content: 'Follow-up evidence for Slice kickoff.',
                status: 'active',
              },
              score: 0.83,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        return [
          {
            memory: {
              id: 'm-1',
              projectId: targetProjectId,
              title: 'Slice kickoff decision',
              content: 'Decision evidence for Slice kickoff.',
              status: 'verified',
            },
            score: 0.91,
            reason: 'hybrid:rpc+rrf',
          },
          {
            memory: {
              id: 'leak-1',
              projectId: otherProjectId,
              title: 'Wrong project leak',
              content: 'This must be filtered out.',
              status: 'active',
            },
            score: 0.99,
            reason: 'hybrid:rpc+rrf',
          },
        ];
      },
    });

    expect(result.outcome).toBe('answered');
    expect(result.stopReason).toBe('enough_evidence');
    expect(result.toolAllowlist).toEqual(AGENTIC_RETRIEVAL_TOOL_ALLOWLIST);
    expect(result.writeActionsAttempted).toBe(0);
    expect(result.trace.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.trace.steps[0]?.scopeFilteredCount).toBe(1);
    expect(result.hits.every((hit) => hit.memory.projectId === targetProjectId)).toBe(true);
    expect(result.context.packedCount).toBeGreaterThan(0);
    expect(calls.some((call) => call.startsWith('history:'))).toBe(true);
  });

  it('stops bounded agentic retrieval when max steps are exhausted', async () => {
    const result = await runBoundedAgenticRetrieval({
      query: 'thin evidence',
      projectId: '44444444-4444-4444-8444-444444444401',
      budget: { maxSteps: 1, minEvidenceHits: 3 },
      search: async () => [
        {
          memory: {
            id: 'only-hit',
            projectId: '44444444-4444-4444-8444-444444444401',
            title: 'Only one candidate',
            content: 'This is not enough evidence.',
            status: 'candidate',
          },
          score: 0.52,
          reason: 'hybrid:rpc+rrf',
        },
      ],
    });

    expect(result.outcome).toBe('budget_exhausted');
    expect(result.stopReason).toBe('max_steps');
    expect(result.budget.usedSteps).toBe(1);
    expect(result.writeActionsAttempted).toBe(0);
  });

  it('requires at least minEvidenceHits eligible hits even when the only hit is verified', async () => {
    const result = await runBoundedAgenticRetrieval({
      query: 'single verified hit',
      projectId: '44444444-4444-4444-8444-444444444401',
      budget: { minEvidenceHits: 2, maxSteps: 4 },
      search: async () => [
        {
          memory: {
            id: 'verified-only',
            projectId: '44444444-4444-4444-8444-444444444401',
            title: 'Only verified result',
            content: 'One verified result is still insufficient here.',
            status: 'verified',
          },
          score: 0.88,
          reason: 'hybrid:rpc+rrf',
        },
      ],
    });

    expect(result.outcome).toBe('not_enough_data');
    expect(result.stopReason).toBe('not_enough_data');
    expect(result.hits).toHaveLength(1);
    expect(result.writeActionsAttempted).toBe(0);
  });

  it('stops bounded agentic retrieval with not enough data when the first search is empty', async () => {
    const result = await runBoundedAgenticRetrieval({
      query: 'missing evidence query',
      projectId: '44444444-4444-4444-8444-444444444401',
      search: async () => [],
    });

    expect(result.outcome).toBe('not_enough_data');
    expect(result.stopReason).toBe('not_enough_data');
    expect(result.hits).toEqual([]);
    expect(result.trace.steps[0]?.hitCount).toBe(0);
  });
});

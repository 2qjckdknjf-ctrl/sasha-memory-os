import { describe, expect, it } from 'vitest';
import { createSeededStore, MemoryStore, type MemoryRecord } from '@memory-os/domain';
import {
  AGENTIC_RETRIEVAL_TOOL_ALLOWLIST,
  authorityMultiplier,
  createSearchRankingWeightsPack,
  DEFAULT_SEARCH_RANKING_WEIGHTS_PACK,
  fuseRanksRrf,
  packSearchContext,
  PERSONALIZED_IMPORTANCE_VERSION,
  projectContext,
  runBoundedAgenticRetrieval,
  SEARCH_RANKING_VERSION,
  SEARCH_RANKING_WEIGHTS_VERSION,
  searchMemories,
  searchMemoriesHybrid,
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

  it('supports weighted RRF list mixing for lexical/vector balance', () => {
    const fused = fuseRanksRrf(
      [
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [{ id: 'c' }, { id: 'b' }, { id: 'a' }],
      ],
      {
        idOf: (row) => row.id,
        listWeights: [3, 1],
      },
    );
    expect(fused[0]?.id).toBe('a');
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it('exposes the official M13 Slice 06 default ranking weights pack', () => {
    expect(DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.version).toBe(
      SEARCH_RANKING_WEIGHTS_VERSION,
    );
    expect(DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.hardFilters).toEqual({
      aclVisibility: 'hard-filter',
      projectMatch: 'hard-filter',
      temporalValidity: 'hard-filter',
    });
    expect(DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.lexical.recencyWeight).toBe(0);
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

  it('applies explicit conflict-penalty weights without changing the default pack', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';
    const store = new MemoryStore();
    const disputed = store.createDecision({
      workspaceId,
      projectId,
      title: 'Release risk dispute',
      content: 'release freeze dispute note',
      actorSubjectId: owner,
      idempotencyKey: 'retrieval-weights-disputed',
      importance: 0.95,
    });
    const active = store.createDecision({
      workspaceId,
      projectId,
      title: 'Release risk active',
      content: 'release freeze dispute note',
      actorSubjectId: owner,
      idempotencyKey: 'retrieval-weights-active',
      importance: 0.7,
    });
    store.setMemoryStatus({
      memoryId: disputed.id,
      status: 'disputed',
      reason: 'ranking weights test',
      actorSubjectId: owner,
    });
    store.setMemoryStatus({
      memoryId: active.id,
      status: 'active',
      reason: 'ranking weights test',
      actorSubjectId: owner,
    });

    const baseline = searchMemories(
      [store.memories.get(disputed.id)!, store.memories.get(active.id)!],
      'release freeze dispute',
      { projectId },
    );
    const noConflictPenalty = searchMemories(
      [store.memories.get(disputed.id)!, store.memories.get(active.id)!],
      'release freeze dispute',
      {
        projectId,
        rankingWeights: createSearchRankingWeightsPack({
          version: 'test-no-conflict-penalty-v1',
          lexical: {
            conflictPenaltyWeight: 0,
          },
        }),
      },
    );

    expect(baseline[0]?.memory.id).toBe(active.id);
    expect(noConflictPenalty[0]?.memory.id).toBe(disputed.id);
  });

  it('keeps the default pack stable when supplied explicitly', async () => {
    const store = createSeededStore();
    const baseline = await searchMemoriesHybrid(
      [...store.memories.values()],
      'Slice 01',
      {
        projectId: '44444444-4444-4444-8444-444444444401',
      },
    );
    const explicit = await searchMemoriesHybrid(
      [...store.memories.values()],
      'Slice 01',
      {
        projectId: '44444444-4444-4444-8444-444444444401',
        rankingWeights: DEFAULT_SEARCH_RANKING_WEIGHTS_PACK,
      },
    );
    expect(explicit.map((hit) => hit.memory.id)).toEqual(
      baseline.map((hit) => hit.memory.id),
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

  it('prefers actor personalization over project default without leaking actor pins', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';
    const cursor = '33333333-3333-4333-8333-333333333303';
    const store = new MemoryStore();
    const actorPinned = store.createDecision({
      workspaceId,
      projectId,
      title: 'Cursor roadmap note',
      content: 'shared roadmap evidence for ranking',
      actorSubjectId: owner,
      idempotencyKey: 'retrieval-personalization-actor',
      importance: 0.2,
    });
    const projectDefaultPinned = store.createDecision({
      workspaceId,
      projectId,
      title: 'Project roadmap note',
      content: 'shared roadmap evidence for ranking',
      actorSubjectId: owner,
      idempotencyKey: 'retrieval-personalization-project',
      importance: 0.2,
    });

    store.setMemoryPersonalization({
      memoryId: actorPinned.id,
      projectId,
      scope: 'actor',
      reason: 'Cursor wants this memory pinned',
      actorSubjectId: cursor,
      pinned: true,
      importanceDelta: 0.4,
      rankingVersion: PERSONALIZED_IMPORTANCE_VERSION,
    });
    store.setMemoryPersonalization({
      memoryId: projectDefaultPinned.id,
      projectId,
      scope: 'project_default',
      reason: 'Project default priority',
      actorSubjectId: owner,
      pinned: true,
      importanceDelta: 0.1,
      rankingVersion: PERSONALIZED_IMPORTANCE_VERSION,
    });

    const cursorHits = searchMemories(
      [actorPinned, projectDefaultPinned],
      'roadmap evidence',
      {
        projectId,
        personalizationByMemoryId: store.listEffectiveMemoryPersonalizations({
          actorSubjectId: cursor,
          projectId,
        }),
      },
    );
    const ownerHits = searchMemories(
      [actorPinned, projectDefaultPinned],
      'roadmap evidence',
      {
        projectId,
        personalizationByMemoryId: store.listEffectiveMemoryPersonalizations({
          actorSubjectId: owner,
          projectId,
        }),
      },
    );

    expect(cursorHits[0]?.memory.id).toBe(actorPinned.id);
    expect(cursorHits[0]?.personalization).toMatchObject({
      scope: 'actor',
      pinned: true,
      rankingVersion: PERSONALIZED_IMPORTANCE_VERSION,
    });
    expect(ownerHits[0]?.memory.id).toBe(projectDefaultPinned.id);
    expect(ownerHits[0]?.personalization).toMatchObject({
      scope: 'project_default',
      pinned: true,
      rankingVersion: PERSONALIZED_IMPORTANCE_VERSION,
    });
  });

  it('records grounded multi-hop trace and keeps every hop scoped to the explicit project', async () => {
    const targetProjectId = '44444444-4444-4444-8444-444444444401';
    const otherProjectId = '44444444-4444-4444-8444-444444444499';
    const calls: string[] = [];
    const result = await runBoundedAgenticRetrieval({
      query: 'Release freeze',
      projectId: targetProjectId,
      budget: { minEvidenceHits: 3 },
      search: async ({ query, includeHistory }) => {
        calls.push(`${includeHistory ? 'history' : 'current'}:${query}`);
        if (query.includes('superseded corrected')) {
          return [
            {
              memory: {
                id: 'm-4',
                projectId: targetProjectId,
                title: 'Release freeze current state',
                content: 'The current verified freeze policy supersedes the old note.',
                status: 'verified',
                supersededBy: null,
              },
              score: 0.82,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        if (query.includes('history timeline')) {
          return [
            {
              memory: {
                id: 'm-3',
                projectId: targetProjectId,
                title: 'Release freeze history note',
                content: 'Historical note confirms the freeze checklist for release.',
                memoryType: 'fact',
                status: 'active',
              },
              score: 0.89,
              reason: 'hybrid:rpc+rrf',
            },
            {
              memory: {
                id: 'timeline-leak',
                projectId: otherProjectId,
                title: 'Wrong project timeline',
                content: 'This history result must be filtered out.',
                status: 'active',
              },
              score: 0.97,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        if (query.includes('task fact')) {
          return [
            {
              memory: {
                id: 'm-2',
                projectId: targetProjectId,
                title: 'Release freeze checklist',
                content: 'Task checklist follows the release freeze decision.',
                memoryType: 'task',
                status: 'active',
              },
              score: 0.94,
              reason: 'hybrid:rpc+rrf',
            },
            {
              memory: {
                id: 'related-leak',
                projectId: otherProjectId,
                title: 'Wrong project task',
                content: 'This related result must be filtered out.',
                memoryType: 'task',
                status: 'active',
              },
              score: 0.99,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        return [
          {
            memory: {
              id: 'm-1',
              projectId: targetProjectId,
              title: 'Release freeze decision',
              content: 'Freeze decision anchors the release process.',
              memoryType: 'decision',
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
    expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
    expect(result.writeActionsAttempted).toBe(0);
    expect(result.trace.steps).toHaveLength(4);
    expect(result.trace.steps[0]?.hop).toBeNull();
    expect(result.trace.steps[1]?.hop).toMatchObject({
      index: 1,
      kind: 'related_evidence',
      groundedByMemoryIds: ['m-1'],
      groundedByTitles: ['Release freeze decision'],
    });
    expect(result.trace.steps[2]?.hop).toMatchObject({
      index: 2,
      kind: 'timeline',
    });
    expect(result.trace.steps[3]?.hop).toMatchObject({
      index: 3,
      kind: 'supersession',
    });
    expect(result.trace.steps[2]?.hop?.groundedByMemoryIds).toEqual(['m-2', 'm-1']);
    expect(result.trace.steps[3]?.hop?.groundedByMemoryIds).toEqual(['m-2', 'm-1']);
    expect(result.trace.steps[0]?.scopeFilteredCount).toBe(1);
    expect(result.trace.steps[1]?.scopeFilteredCount).toBe(1);
    expect(result.trace.steps[2]?.scopeFilteredCount).toBe(1);
    expect(result.hits.every((hit) => hit.memory.projectId === targetProjectId)).toBe(true);
    expect(result.context.packedCount).toBeGreaterThan(0);
    expect(calls[0]).toBe('current:Release freeze');
    expect(calls[1]).toContain('task fact');
    expect(calls[2]).toContain('history timeline');
    expect(calls[3]).toContain('superseded corrected');
  });

  it('uses a compact grounded hop query so related project evidence still passes lexical coverage', async () => {
    const projectId = '44444444-4444-4444-8444-444444444401';
    const records: MemoryRecord[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        projectId,
        memoryType: 'decision',
        title: 'Release freeze decision',
        content: 'Decision approvals guardrails anchor the release freeze.',
        status: 'verified',
        importance: 0.9,
        confidence: 0.95,
        sensitivity: 'internal',
        validFrom: null,
        validTo: null,
        observedAt: null,
        recordedAt: '2026-08-20T03:30:00.000Z',
        supersededBy: null,
        sourceEventId: null,
        createdBySubject: null,
        schemaVersion: '1.0',
        metadata: {},
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        projectId,
        memoryType: 'task',
        title: 'Release freeze checklist',
        content: 'Task checklist for the release freeze.',
        status: 'active',
        importance: 0.82,
        confidence: 0.9,
        sensitivity: 'internal',
        validFrom: null,
        validTo: null,
        observedAt: null,
        recordedAt: '2026-08-20T03:31:00.000Z',
        supersededBy: null,
        sourceEventId: null,
        createdBySubject: null,
        schemaVersion: '1.0',
        metadata: {},
      },
    ];

    const result = await runBoundedAgenticRetrieval({
      query: 'release freeze decision approvals guardrails',
      projectId,
      budget: { maxSteps: 2, minEvidenceHits: 2 },
      search: async ({ query, includeHistory, projectId }) =>
        searchMemories(records, query, { includeHistory, projectId }),
    });

    expect(result.trace.steps[0]?.hitCount).toBe(1);
    expect(result.trace.steps[1]?.hop).toMatchObject({
      index: 1,
      kind: 'related_evidence',
    });
    expect(result.trace.steps[1]?.query).toBe('release freeze decision task');
    expect(result.trace.steps[1]?.query).not.toContain('approvals');
    expect(result.trace.steps[1]?.query).not.toContain('guardrails');
    expect(result.outcome).toBe('answered');
    expect(result.stopReason).toBe('enough_evidence');
    expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
    expect(result.hits.map((hit) => hit.memory.title)).toEqual([
      'Release freeze decision',
      'Release freeze checklist',
    ]);
  });

  it('stops bounded agentic retrieval when max steps are exhausted mid-hop plan', async () => {
    const result = await runBoundedAgenticRetrieval({
      query: 'thin evidence',
      projectId: '44444444-4444-4444-8444-444444444401',
      budget: { maxSteps: 2, minEvidenceHits: 3 },
      search: async ({ query }) => {
        if (query.includes('task fact')) {
          return [
            {
              memory: {
                id: 'second-hop',
                projectId: '44444444-4444-4444-8444-444444444401',
                title: 'Second supporting memory',
                content: 'A second hit is still not enough evidence.',
                memoryType: 'task',
                status: 'active',
              },
              score: 0.71,
              reason: 'hybrid:rpc+rrf',
            },
          ];
        }
        return [
          {
            memory: {
              id: 'only-hit',
              projectId: '44444444-4444-4444-8444-444444444401',
              title: 'Only one candidate',
              content: 'This is not enough evidence.',
              memoryType: 'decision',
              status: 'candidate',
            },
            score: 0.52,
            reason: 'hybrid:rpc+rrf',
          },
        ];
      },
    });

    expect(result.outcome).toBe('budget_exhausted');
    expect(result.stopReason).toBe('max_steps');
    expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
    expect(result.budget.usedSteps).toBe(2);
    expect(result.trace.steps[1]?.hop).toMatchObject({
      index: 1,
      kind: 'related_evidence',
      groundedByMemoryIds: ['only-hit'],
    });
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

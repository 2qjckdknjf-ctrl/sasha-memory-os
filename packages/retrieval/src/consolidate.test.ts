import { describe, expect, it } from 'vitest';
import {
  buildProactiveConsolidationReason,
  planCandidateConsolidations,
  planProactiveConsolidation,
  PROACTIVE_CONSOLIDATION_RULES_VERSION,
} from './consolidate.js';

describe('planCandidateConsolidations', () => {
  it('pairs exact title duplicates and keeps the newer candidate', async () => {
    const pairs = await planCandidateConsolidations([
      {
        id: 'old',
        title: 'Pilot Kickoff Note',
        content: 'older copy',
        status: 'candidate',
        recordedAt: '2026-08-10T10:00:00.000Z',
      },
      {
        id: 'new',
        title: 'pilot kickoff note',
        content: 'newer copy',
        status: 'candidate',
        recordedAt: '2026-08-11T10:00:00.000Z',
      },
      {
        id: 'other',
        title: 'Unrelated calendar note',
        content: 'meetings',
        status: 'candidate',
        recordedAt: '2026-08-11T11:00:00.000Z',
      },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.keeperId).toBe('new');
    expect(pairs[0]?.duplicateId).toBe('old');
    expect(pairs[0]?.reason).toBe('exact-title');
  });
});

describe('planProactiveConsolidation', () => {
  it('bounds planned merges and keeps zero verified writes', async () => {
    const plan = await planProactiveConsolidation(
      [
        {
          id: 'a-old',
          title: 'Release checklist',
          content: 'older copy',
          status: 'candidate',
          recordedAt: '2026-08-20T01:00:00.000Z',
        },
        {
          id: 'a-new',
          title: 'release checklist',
          content: 'newer copy',
          status: 'candidate',
          recordedAt: '2026-08-20T02:00:00.000Z',
        },
        {
          id: 'b-old',
          title: 'Launch brief',
          content: 'older copy',
          status: 'candidate',
          recordedAt: '2026-08-20T01:30:00.000Z',
        },
        {
          id: 'b-new',
          title: 'launch brief',
          content: 'newer copy',
          status: 'candidate',
          recordedAt: '2026-08-20T02:30:00.000Z',
        },
      ],
      {
        maxMerges: 1,
      },
    );

    expect(plan.rulesVersion).toBe(PROACTIVE_CONSOLIDATION_RULES_VERSION);
    expect(plan.mergeCandidates).toHaveLength(1);
    expect(plan.mergeCandidatesTotal).toBe(2);
    expect(plan.stopReason).toBe('max_merges');
    expect(plan.exhausted).toBe(true);
    expect(plan.verifiedWrites).toBe(0);
  });

  it('emits candidate conflicts instead of auto-promoting reviewed memories', async () => {
    const plan = await planProactiveConsolidation([
      {
        id: 'verified-memory',
        title: 'API base URL',
        content: 'Use https://api.example.com.',
        status: 'verified',
        recordedAt: '2026-08-20T01:00:00.000Z',
      },
      {
        id: 'candidate-memory',
        title: 'api base url',
        content: 'Use https://staging.example.com until cutover.',
        status: 'candidate',
        recordedAt: '2026-08-20T02:00:00.000Z',
      },
    ]);

    expect(plan.mergeCandidates).toEqual([]);
    expect(plan.candidateConflicts).toEqual([
      expect.objectContaining({
        title: 'api base url',
        reason: 'same-title-divergent-content',
        memoryIds: ['candidate-memory', 'verified-memory'],
        statuses: ['candidate', 'verified'],
      }),
    ]);
    expect(plan.verifiedWrites).toBe(0);
  });

  it('stops on time budget with a partial plan', async () => {
    let ticks = 0;
    const now = () => {
      ticks += 1;
      return ticks * 10;
    };

    const plan = await planProactiveConsolidation(
      [
        {
          id: 'old',
          title: 'Retrospective',
          content: 'older copy',
          status: 'candidate',
          recordedAt: '2026-08-20T01:00:00.000Z',
        },
        {
          id: 'new',
          title: 'retrospective',
          content: 'newer copy',
          status: 'candidate',
          recordedAt: '2026-08-20T02:00:00.000Z',
        },
      ],
      {
        maxTimeMs: 15,
        now,
      },
    );

    expect(plan.stopReason).toBe('max_time_ms');
    expect(plan.exhausted).toBe(true);
    expect(plan.mergeCandidatesTotal).toBeGreaterThanOrEqual(plan.mergeCandidates.length);
  });
});

describe('buildProactiveConsolidationReason', () => {
  it('embeds the rules version and run id into the persisted reason', () => {
    expect(
      buildProactiveConsolidationReason({
        runId: 'run-123',
        pairReason: 'exact-title',
      }),
    ).toBe(
      `consolidation.proactive ${PROACTIVE_CONSOLIDATION_RULES_VERSION} run run-123: exact-title`,
    );
  });
});

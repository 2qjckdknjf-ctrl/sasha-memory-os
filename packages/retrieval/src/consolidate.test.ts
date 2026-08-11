import { describe, expect, it } from 'vitest';
import { planCandidateConsolidations } from './consolidate.js';

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

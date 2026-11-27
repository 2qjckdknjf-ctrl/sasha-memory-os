import { describe, expect, it } from 'vitest';
import { createSeededStore } from './store.js';

describe('MemoryStore consolidation proposal review', () => {
  it('rejects self-approval, approves independent review, and supports rollback', () => {
    const store = createSeededStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444402';
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const detectorId = '33333333-3333-4333-8333-333333333304';

    const first = store.captureText({
      workspaceId,
      projectId,
      title: 'False billing currency',
      text: 'Always charge USD.',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-proposal/false-a',
    });
    const second = store.captureText({
      workspaceId,
      projectId,
      title: 'false billing currency',
      text: 'Charge EUR for EU customers.',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-proposal/false-b',
    });

    const conflict = store.upsertMemoryConflict({
      workspaceId,
      projectId,
      conflictKey: `${first.memoryId}::${second.memoryId}::near-duplicate-merge`,
      title: 'False billing currency',
      reason: 'near-duplicate-merge',
      memoryIds: [first.memoryId, second.memoryId],
      evidence: [
        { memoryId: first.memoryId, title: 'False billing currency' },
        { memoryId: second.memoryId, title: 'false billing currency' },
      ],
      detectorVersion: 'm20-s03-proposal-v1',
      actorSubjectId: detectorId,
    });

    expect(() =>
      store.decideMemoryConflict({
        conflictId: conflict.id,
        decision: 'approve',
        reason: 'self approval must fail',
        actorSubjectId: detectorId,
        keeperId: second.memoryId,
        duplicateId: first.memoryId,
      }),
    ).toThrow(/self-approve/);

    const approved = store.decideMemoryConflict({
      conflictId: conflict.id,
      decision: 'approve',
      reason: 'independent owner approval',
      actorSubjectId: ownerId,
      keeperId: second.memoryId,
      duplicateId: first.memoryId,
    });
    expect(approved.status).toBe('resolved');
    expect(store.memories.get(first.memoryId)?.status).toBe('superseded');

    const rolledBack = store.decideMemoryConflict({
      conflictId: conflict.id,
      decision: 'rollback',
      reason: 'restore prior trusted retrieval state',
      actorSubjectId: ownerId,
    });
    expect(rolledBack.status).toBe('candidate');
    expect(store.memories.get(first.memoryId)?.status).not.toBe('superseded');
  });
});

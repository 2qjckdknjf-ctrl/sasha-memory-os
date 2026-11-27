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

  it('keeps dismissed and resolved review state when the same conflict is detected again', () => {
    const store = createSeededStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444402';
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const detectorId = '33333333-3333-4333-8333-333333333304';
    const first = store.captureText({
      workspaceId,
      projectId,
      title: 'Repeat scan',
      text: 'first',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-redetect/a',
    });
    const second = store.captureText({
      workspaceId,
      projectId,
      title: 'repeat scan',
      text: 'second',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-redetect/b',
    });
    const input = {
      workspaceId,
      projectId,
      conflictKey: `${first.memoryId}::${second.memoryId}::near-duplicate-merge`,
      title: 'Repeat scan',
      reason: 'near-duplicate-merge',
      memoryIds: [first.memoryId, second.memoryId] as [string, string],
      evidence: [
        { memoryId: first.memoryId, title: 'Repeat scan' },
        { memoryId: second.memoryId, title: 'repeat scan' },
      ] as [
        { memoryId: string; title: string },
        { memoryId: string; title: string },
      ],
      detectorVersion: 'm20-s03-proposal-v1',
      actorSubjectId: detectorId,
    };
    const conflict = store.upsertMemoryConflict(input);
    const dismissed = store.decideMemoryConflict({
      conflictId: conflict.id,
      decision: 'dismiss',
      reason: 'keep both',
      actorSubjectId: ownerId,
    });
    const again = store.upsertMemoryConflict({
      ...input,
      title: 'Repeat scan rewritten',
    });
    expect(again.id).toBe(conflict.id);
    expect(again.status).toBe('dismissed');
    expect(again.title).toBe(dismissed.title);
    expect(again.resolution).toEqual(dismissed.resolution);
    expect(again.resolvedBySubject).toBe(ownerId);
    expect(again.detectionCount).toBe(2);
  });

  it('approves the newer recorded memory when keeper ids are omitted', () => {
    const store = createSeededStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444402';
    const ownerId = '33333333-3333-4333-8333-333333333301';
    const detectorId = '33333333-3333-4333-8333-333333333304';
    const older = store.captureText({
      workspaceId,
      projectId,
      title: 'Survivor order',
      text: 'old fact',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-keeper/old',
    });
    const newer = store.captureText({
      workspaceId,
      projectId,
      title: 'survivor order',
      text: 'new fact',
      actorSubjectId: ownerId,
      idempotencyKey: 'consol-keeper/new',
    });
    const olderRecord = store.memories.get(older.memoryId);
    const newerRecord = store.memories.get(newer.memoryId);
    if (!olderRecord || !newerRecord) throw new Error('memories missing');
    olderRecord.recordedAt = '2020-01-01T00:00:00.000Z';
    newerRecord.recordedAt = '2024-01-01T00:00:00.000Z';
    const [leftId, rightId] = [older.memoryId, newer.memoryId].sort((a, b) =>
      a.localeCompare(b),
    ) as [string, string];
    const conflict = store.upsertMemoryConflict({
      workspaceId,
      projectId,
      conflictKey: `${leftId}::${rightId}::stale-version`,
      title: 'Survivor order',
      reason: 'stale-version',
      memoryIds: [leftId, rightId],
      evidence: [
        { memoryId: leftId, title: 'Survivor order' },
        { memoryId: rightId, title: 'survivor order' },
      ],
      detectorVersion: 'm20-s03-proposal-v1',
      actorSubjectId: detectorId,
    });
    const approved = store.decideMemoryConflict({
      conflictId: conflict.id,
      decision: 'approve',
      reason: 'keep the newer fact',
      actorSubjectId: ownerId,
    });
    expect(approved.resolution?.keeperId).toBe(newer.memoryId);
    expect(approved.resolution?.duplicateId).toBe(older.memoryId);
    expect(store.memories.get(older.memoryId)?.status).toBe('superseded');
    expect(store.memories.get(newer.memoryId)?.status).not.toBe('superseded');
  });
});

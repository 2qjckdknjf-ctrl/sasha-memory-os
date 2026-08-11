import { MemoryStore } from '@memory-os/domain';
import { describe, expect, it } from 'vitest';
import { consolidateLocalStore, parseWorkerIntervalMs } from './index.js';

describe('parseWorkerIntervalMs', () => {
  it('returns null when unset', () => {
    expect(parseWorkerIntervalMs({})).toBeNull();
  });
  it('parses valid interval', () => {
    expect(parseWorkerIntervalMs({ MEMORY_OS_WORKER_INTERVAL_MS: '60000' })).toBe(
      60000,
    );
  });
  it('rejects short intervals', () => {
    expect(() =>
      parseWorkerIntervalMs({ MEMORY_OS_WORKER_INTERVAL_MS: '100' }),
    ).toThrow(/>= 1000/);
  });
});

describe('consolidateLocalStore', () => {
  it('supersedes duplicate candidate titles in the local store', async () => {
    const store = new MemoryStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';

    const first = store.captureText({
      workspaceId,
      projectId,
      title: 'Duplicate Capture',
      text: 'first version of the same note',
      actorSubjectId: owner,
      idempotencyKey: 'consol/a',
    });
    const second = store.captureText({
      workspaceId,
      projectId,
      title: 'duplicate capture',
      text: 'second version of the same note',
      actorSubjectId: owner,
      idempotencyKey: 'consol/b',
    });

    const report = await consolidateLocalStore(store, { actorSubjectId: owner });
    expect(report.applied).toHaveLength(1);
    const dupId = report.applied[0]!.duplicateId;
    const keeperId = report.applied[0]!.keeperId;
    expect([first.memoryId, second.memoryId]).toContain(dupId);
    expect([first.memoryId, second.memoryId]).toContain(keeperId);
    expect(store.memories.get(dupId)?.status).toBe('superseded');
    expect(store.memories.get(dupId)?.supersededBy).toBe(keeperId);
  });
});

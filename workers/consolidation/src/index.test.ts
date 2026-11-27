import { MemoryStore } from '@memory-os/domain';
import { CONSOLIDATION_PROPOSAL_DETECTOR_SUBJECT } from '@memory-os/retrieval';
import { describe, expect, it } from 'vitest';
import {
  consolidateLocalStore,
  parseProactiveConsolidationEnv,
  parseWorkerIntervalMs,
  runProactiveConsolidationLocalStore,
} from './index.js';

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

describe('parseProactiveConsolidationEnv', () => {
  it('returns null when proactive consolidation is not configured', () => {
    expect(parseProactiveConsolidationEnv({})).toBeNull();
  });

  it('requires an explicit subject id for scheduled proactive runs', () => {
    expect(() =>
      parseProactiveConsolidationEnv({
        MEMORY_OS_CONSOLIDATION_PROJECT_ID:
          '44444444-4444-4444-8444-444444444401',
      }),
    ).toThrow(/MEMORY_OS_CONSOLIDATION_SUBJECT_ID is required/i);
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

describe('runProactiveConsolidationLocalStore', () => {
  it('requires an explicit project_id and never falls back to AISTROYKA', async () => {
    const store = new MemoryStore();
    await expect(
      runProactiveConsolidationLocalStore({
        store,
        workspaceId: '11111111-1111-4111-8111-111111111111',
        subjectId: '33333333-3333-4333-8333-333333333301',
        projectId: '',
      }),
    ).rejects.toThrow(/project_id is required for proactive consolidation/i);
  });

  it('stays project-scoped, avoids silent verified writes, and audits the run', async () => {
    const store = new MemoryStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const otherProjectId = '44444444-4444-4444-8444-444444444430';
    const owner = '33333333-3333-4333-8333-333333333301';

    const scopedA = store.captureText({
      workspaceId,
      projectId,
      title: 'Scoped duplicate',
      text: 'first scoped copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/scoped-a',
    });
    const scopedB = store.captureText({
      workspaceId,
      projectId,
      title: 'scoped duplicate',
      text: 'second scoped copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/scoped-b',
    });
    const otherA = store.captureText({
      workspaceId,
      projectId: otherProjectId,
      title: 'Scoped duplicate',
      text: 'other project copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/other-a',
    });
    const otherB = store.captureText({
      workspaceId,
      projectId: otherProjectId,
      title: 'scoped duplicate',
      text: 'other project second copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/other-b',
    });

    const report = await runProactiveConsolidationLocalStore({
      store,
      workspaceId,
      subjectId: owner,
      projectId,
      apply: true,
    });

    expect(report.projectId).toBe(projectId);
    expect(report.applied).toHaveLength(1);
    expect(report.verifiedWrites).toBe(0);
    expect(report.auditEventId).toBeTruthy();
    expect(report.persistedConflictIds.length).toBeGreaterThanOrEqual(1);
    expect(store.memories.get(scopedA.memoryId)?.status).not.toBe('verified');
    expect(store.memories.get(scopedB.memoryId)?.status).not.toBe('verified');
    expect(store.memories.get(otherA.memoryId)?.status).toBe('candidate');
    expect(store.memories.get(otherB.memoryId)?.status).toBe('candidate');

    const runAudit = store.auditLog.find(
      (entry) => entry.action === 'consolidation.proactive.completed',
    );
    expect(runAudit?.afterState).toEqual(
      expect.objectContaining({
        projectId,
        verifiedWrites: 0,
      }),
    );
  });

  it('emits candidate conflicts and stops when merge bounds are exhausted', async () => {
    const store = new MemoryStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';

    await store.captureText({
      workspaceId,
      projectId,
      title: 'Merge A',
      text: 'older copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/merge-a-1',
    });
    await store.captureText({
      workspaceId,
      projectId,
      title: 'merge a',
      text: 'newer copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/merge-a-2',
    });
    await store.captureText({
      workspaceId,
      projectId,
      title: 'Merge B',
      text: 'older copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/merge-b-1',
    });
    await store.captureText({
      workspaceId,
      projectId,
      title: 'merge b',
      text: 'newer copy',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/merge-b-2',
    });
    store.createDecision({
      workspaceId,
      projectId,
      title: 'API base URL',
      content: 'Use https://api.example.com.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/conflict-verified',
    });
    await store.captureText({
      workspaceId,
      projectId,
      title: 'api base url',
      text: 'Use https://staging.example.com until cutover.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/conflict-candidate',
    });

    const report = await runProactiveConsolidationLocalStore({
      store,
      workspaceId,
      subjectId: owner,
      projectId,
      apply: false,
      maxMerges: 1,
    });

    expect(report.planned).toBe(1);
    expect(report.mergeCandidatesTotal).toBeGreaterThanOrEqual(2);
    expect(report.stopReason).toBe('max_merges');
    expect(report.exhausted).toBe(true);
    expect(report.candidateConflicts).toEqual([
      expect.objectContaining({
        reason: 'same-title-divergent-content',
      }),
    ]);
    expect(
      report.detectedConflicts.some(
        (conflict) => conflict.reason === 'same-title-divergent-content',
      ),
    ).toBe(true);
    expect(report.applied).toEqual([]);
  });

  it('persists durable contradiction candidates with evidence ids and titles only', async () => {
    const store = new MemoryStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';

    const corrected = store.createDecision({
      workspaceId,
      projectId,
      title: 'API region',
      content: 'Use eu-central-1.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive-corrected-new',
    });
    const captured = store.captureText({
      workspaceId,
      projectId,
      title: 'api region',
      text: 'Use us-east-1.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive-corrected-old',
    });
    store.correctMemory({
      memoryId: captured.memoryId,
      replacementMemoryId: corrected.id,
      reason: 'Correct region.',
      actorSubjectId: owner,
    });

    const report = await runProactiveConsolidationLocalStore({
      store,
      workspaceId,
      subjectId: owner,
      projectId,
      apply: false,
    });

    expect(report.verifiedWrites).toBe(0);
    expect(report.detectedConflicts).toEqual([
      expect.objectContaining({
        reason: 'corrected-current-fact',
      }),
    ]);
    expect(report.persistedConflictIds).toHaveLength(1);
    const conflicts = store.listMemoryConflicts(workspaceId, projectId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe('corrected-current-fact');
    expect(conflicts[0]?.createdBySubject).toBe(CONSOLIDATION_PROPOSAL_DETECTOR_SUBJECT);
    expect(conflicts[0]?.evidence).toEqual(
      expect.arrayContaining([
        { memoryId: corrected.id, title: 'API region' },
        { memoryId: captured.memoryId, title: 'api region' },
      ]),
    );
    expect(JSON.stringify(conflicts[0])).not.toContain('eu-central-1');
    expect(JSON.stringify(conflicts[0])).not.toContain('us-east-1');
    expect(
      store.auditLog.some((entry) => entry.action === 'memory_conflict.detected'),
    ).toBe(true);
  });

  it('proposes stale versions when validTo is expired and lets the owner approve', async () => {
    const store = new MemoryStore();
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    const projectId = '44444444-4444-4444-8444-444444444401';
    const owner = '33333333-3333-4333-8333-333333333301';
    const expired = store.captureText({
      workspaceId,
      projectId,
      title: 'Stale price',
      text: 'Price is 10.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/stale-old',
    });
    const current = store.captureText({
      workspaceId,
      projectId,
      title: 'stale price',
      text: 'Price is 12.',
      actorSubjectId: owner,
      idempotencyKey: 'proactive/stale-new',
    });
    const expiredRecord = store.memories.get(expired.memoryId);
    const currentRecord = store.memories.get(current.memoryId);
    if (!expiredRecord || !currentRecord) throw new Error('memories missing');
    expiredRecord.recordedAt = '2020-01-01T00:00:00.000Z';
    expiredRecord.validTo = '2020-06-01T00:00:00.000Z';
    currentRecord.recordedAt = '2024-01-01T00:00:00.000Z';
    currentRecord.validTo = null;

    const report = await runProactiveConsolidationLocalStore({
      store,
      workspaceId,
      subjectId: owner,
      projectId,
      apply: false,
    });

    expect(
      report.detectedConflicts.some((conflict) => conflict.reason === 'stale-version'),
    ).toBe(true);
    const conflict = store
      .listMemoryConflicts(workspaceId, projectId)
      .find((entry) => entry.reason === 'stale-version');
    expect(conflict?.createdBySubject).toBe(CONSOLIDATION_PROPOSAL_DETECTOR_SUBJECT);
    const approved = store.decideMemoryConflict({
      conflictId: conflict?.id ?? '',
      decision: 'approve',
      reason: 'owner accepts the current price',
      actorSubjectId: owner,
    });
    expect(approved.resolution?.keeperId).toBe(current.memoryId);
    expect(store.memories.get(expired.memoryId)?.status).toBe('superseded');
    expect(store.memories.get(current.memoryId)?.status).not.toBe('superseded');
  });
});

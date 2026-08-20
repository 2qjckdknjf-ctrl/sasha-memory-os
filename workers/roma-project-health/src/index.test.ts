import { describe, expect, it, vi } from 'vitest';
import {
  parseWorkerIntervalMs,
  runRomaProjectHealthJob,
  runRomaProjectHealthTick,
  type ClaimedRomaProjectHealthJob,
} from './index.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444401';
const owner = '33333333-3333-4333-8333-333333333301';
const roma = '33333333-3333-4333-8333-333333333304';

function buildJob(
  overrides: Partial<ClaimedRomaProjectHealthJob> = {},
): ClaimedRomaProjectHealthJob {
  return {
    jobId: 'job-roma-1',
    workspaceId,
    status: 'running',
    attempt: 0,
    error: null,
    idempotencyKey: 'roma-project-health/44444444-4444-4444-8444-444444444401/slice-01',
    requestEventId: 'event-roma-1',
    projectId,
    requestedBy: owner,
    reason: 'Generate one audited summary.',
    ...overrides,
  };
}

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

describe('runRomaProjectHealthJob', () => {
  it('writes the summary as ROMA and avoids quoting raw memory bodies', async () => {
    const captureConnectorRecord = vi.fn(async (_input: Record<string, any>) => ({
      eventId: 'source-roma-1',
      process: { memoryId: 'memory-roma-1' },
    }));
    const appendAuditEvent = vi.fn(async () => ({ id: 'audit-roma-1' }));
    const completeRomaProjectHealth = vi.fn(async () => ({
      jobId: 'job-roma-1',
      status: 'succeeded',
    }));
    const gateway = {
      listProjects: vi.fn(async () => [
        {
          id: projectId,
          slug: 'aistroyka',
          name: 'AISTROYKA',
          status: 'active',
        },
      ]),
      projectContext: vi.fn(async () => ({
        projectId,
        decisions: [
          {
            title: 'Kickoff order',
            content: 'Decision body must not be copied verbatim.',
          },
        ],
        tasks: [
          {
            title: 'Implement Slice 01',
            content: 'Task body must not be copied verbatim.',
          },
        ],
        facts: [
          {
            title: 'Risk register refreshed',
            content: 'Private salary discussion that must never be quoted.',
          },
        ],
        state: {
          version: 2,
          summary: 'Slice 01 is ready for implementation after audit.',
          state: {
            stage: 'slice-01-ready',
            completed: ['product-design-audit'],
            blocked: [],
            next: ['implement slice 01'],
            risks: ['keep audit trail bounded to one project'],
          },
        },
        latestHandoff: {
          createdAt: '2026-08-20T01:00:00.000Z',
          payload: {
            summary: 'Cursor handed off the remediation queue.',
          },
        },
      })),
      captureConnectorRecord,
      appendAuditEvent,
      completeRomaProjectHealth,
    };

    const result = await runRomaProjectHealthJob({
      gateway: gateway as any,
      job: buildJob(),
      romaSubjectId: roma,
    });

    expect(result.memoryId).toBe('memory-roma-1');
    expect(captureConnectorRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        projectId,
        provider: 'roma',
        idempotencyKey:
          'roma-project-health/44444444-4444-4444-8444-444444444401/slice-01',
      }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        action: 'roma.project_health.written',
        objectId: 'memory-roma-1',
      }),
    );
    expect(completeRomaProjectHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-roma-1',
        status: 'succeeded',
        memoryId: 'memory-roma-1',
        auditEventId: 'audit-roma-1',
      }),
    );

    const captureInput = captureConnectorRecord.mock.calls[0]?.[0] as
      | Record<string, any>
      | undefined;
    expect(captureInput?.subjectId).not.toBe(owner);
    expect(captureInput?.text).toContain('Risk register refreshed');
    expect(captureInput?.text).not.toContain(
      'Private salary discussion that must never be quoted.',
    );
    expect(captureInput?.text).toContain(
      'titles and structured state only; raw memory bodies are not quoted',
    );
    expect(captureInput?.provenance?.automation?.requestedBy).toBe(owner);
    expect(captureInput?.metadata?.summary_type).toBe('project_health');
  });

  it('fails the job when the project is not visible to ROMA', async () => {
    const completeRomaProjectHealth = vi.fn(async () => ({
      jobId: 'job-roma-1',
      status: 'failed',
    }));
    const gateway = {
      listProjects: vi.fn(async () => []),
      projectContext: vi.fn(),
      captureConnectorRecord: vi.fn(),
      appendAuditEvent: vi.fn(),
      completeRomaProjectHealth,
    };

    await expect(
      runRomaProjectHealthJob({
        gateway: gateway as any,
        job: buildJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/not visible to ROMA/i);

    expect(completeRomaProjectHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-roma-1',
        status: 'failed',
      }),
    );
  });
});

describe('runRomaProjectHealthTick', () => {
  it('ticks due schedules before claiming project-health jobs', async () => {
    const tickRomaProjectHealthSchedules = vi.fn(async () => ({
      count: 1,
      enqueued: [
        {
          scheduleId: 'schedule-1',
          projectId,
          periodStart: '2026-08-20T01:00:00.000Z',
          nextRunAt: '2026-08-20T13:00:00.000Z',
          jobId: 'job-queued-1',
          inserted: true,
          skippedIntervals: 0,
          idempotencyKey: 'roma-project-health/44444444-4444-4444-8444-444444444401/schedule-1',
        },
      ],
      disabled: [],
      errors: [],
    }));
    const gateway = {
      tickRomaProjectHealthSchedules,
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 0 })),
      claimRomaProjectHealthJobs: vi.fn(async () => ({ count: 0, jobs: [] })),
      listProjects: vi.fn(),
      projectContext: vi.fn(),
      captureConnectorRecord: vi.fn(),
      appendAuditEvent: vi.fn(),
      completeRomaProjectHealth: vi.fn(),
      retryRomaProjectHealth: vi.fn(),
    };

    const report = await runRomaProjectHealthTick({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(tickRomaProjectHealthSchedules).toHaveBeenCalledWith({
      subjectId: roma,
      workspaceId,
      limit: 10,
      projectId: null,
    });
    expect(report.scheduled.enqueued).toHaveLength(1);
    expect(report.claimed).toBe(0);
  });

  it('requeues a retryable first-attempt failure instead of consuming the request', async () => {
    const retryRomaProjectHealth = vi.fn(async () => ({
      jobId: 'job-roma-1',
      status: 'queued',
      attempt: 1,
      jobType: 'roma_project_health',
      error: 'temporary audit outage',
    }));
    const completeRomaProjectHealth = vi.fn(async () => ({
      jobId: 'job-roma-1',
      status: 'failed',
    }));
    const gateway = {
      tickRomaProjectHealthSchedules: vi.fn(async () => ({
        count: 0,
        enqueued: [],
        disabled: [],
        errors: [],
      })),
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 1 })),
      claimRomaProjectHealthJobs: vi.fn(async () => ({
        count: 1,
        jobs: [buildJob({ attempt: 0 })],
      })),
      listProjects: vi.fn(async () => [
        {
          id: projectId,
          slug: 'aistroyka',
          name: 'AISTROYKA',
          status: 'active',
        },
      ]),
      projectContext: vi.fn(async () => ({
        projectId,
        decisions: [],
        tasks: [],
        facts: [],
        state: null,
        latestHandoff: null,
      })),
      captureConnectorRecord: vi.fn(async () => {
        throw new Error('temporary audit outage');
      }),
      appendAuditEvent: vi.fn(),
      completeRomaProjectHealth,
      retryRomaProjectHealth,
    };

    const report = await runRomaProjectHealthTick({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(retryRomaProjectHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-roma-1',
        error: 'temporary audit outage',
      }),
    );
    expect(completeRomaProjectHealth).not.toHaveBeenCalled();
    expect(report.pendingOutbox).toBe(1);
  });

  it('does not duplicate writes after the queue is drained', async () => {
    let claimCount = 0;
    const captureConnectorRecord = vi.fn(async (_input: Record<string, any>) => ({
      eventId: 'source-roma-1',
      process: { memoryId: 'memory-roma-1' },
    }));
    const listOutboxPending = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const gateway = {
      tickRomaProjectHealthSchedules: vi
        .fn()
        .mockResolvedValueOnce({
          count: 1,
          enqueued: [
            {
              scheduleId: 'schedule-1',
              projectId,
              periodStart: '2026-08-20T01:00:00.000Z',
              nextRunAt: '2026-08-20T13:00:00.000Z',
              jobId: 'job-roma-1',
              inserted: true,
              skippedIntervals: 0,
              idempotencyKey:
                'roma-project-health/44444444-4444-4444-8444-444444444401/schedule-1',
            },
          ],
          disabled: [],
          errors: [],
        })
        .mockResolvedValueOnce({
          count: 0,
          enqueued: [],
          disabled: [],
          errors: [],
        }),
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending,
      claimRomaProjectHealthJobs: vi.fn(async () => {
        claimCount += 1;
        return claimCount === 1
          ? { count: 1, jobs: [buildJob()] }
          : { count: 0, jobs: [] };
      }),
      listProjects: vi.fn(async () => [
        {
          id: projectId,
          slug: 'aistroyka',
          name: 'AISTROYKA',
          status: 'active',
        },
      ]),
      projectContext: vi.fn(async () => ({
        projectId,
        decisions: [],
        tasks: [],
        facts: [],
        state: null,
        latestHandoff: null,
      })),
      captureConnectorRecord,
      appendAuditEvent: vi.fn(async () => ({ id: 'audit-roma-1' })),
      completeRomaProjectHealth: vi.fn(async () => ({
        jobId: 'job-roma-1',
        status: 'succeeded',
      })),
      retryRomaProjectHealth: vi.fn(),
    };

    const first = await runRomaProjectHealthTick({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });
    const second = await runRomaProjectHealthTick({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(first.claimed).toBe(1);
    expect(first.completed).toHaveLength(1);
    expect(first.scheduled.enqueued).toHaveLength(1);
    expect(first.pendingOutbox).toBe(0);
    expect(second.claimed).toBe(0);
    expect(second.completed).toHaveLength(0);
    expect(second.scheduled.enqueued).toHaveLength(0);
    expect(captureConnectorRecord).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  buildRomaQaFindingApprovalCheckpointRequest,
  parseWorkerIntervalMs,
  resolveRomaSubjectId,
  runRomaAutomationOnce,
  runRomaProjectFindingsJob,
  runRomaProjectFindingsTick,
  runRomaProjectHealthJob,
  runRomaProjectHealthTick,
  type ClaimedRomaProjectFindingsJob,
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

function buildFindingsJob(
  overrides: Partial<ClaimedRomaProjectFindingsJob> = {},
): ClaimedRomaProjectFindingsJob {
  return {
    jobId: 'job-findings-1',
    workspaceId,
    status: 'running',
    attempt: 0,
    error: null,
    idempotencyKey: 'roma-project-findings/44444444-4444-4444-8444-444444444401/slice-03',
    requestEventId: 'event-findings-1',
    projectId,
    requestedBy: owner,
    reason: 'Generate bounded ROMA QA findings.',
    ...overrides,
  };
}

function buildReleaseContext(
  mergeSha = '49d051c436fd2a4fbe9d7f64661edb0b3880aaa0',
  options: {
    milestoneTitle?: string;
    deploymentLine?: string;
  } = {},
) {
  return {
    projectId,
    decisions: [
      {
        id: 'milestone-m18-2',
        projectId,
        title:
          options.milestoneTitle ??
          'M18.2 PROJECT CONTEXT PACK LIVE PASS — PR #103',
        content: [
          options.deploymentLine ?? 'Production Edge v11 deployment is live.',
          'PR: https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103',
          `Merge SHA: ${mergeSha}`,
          'Blockers:',
          '- Private deployment credential detail must not be copied.',
          '- Release owner approval is pending.',
          '- Deployment audit receipt needs review.',
          'Next: M18.3 ROMA integration.',
        ].join('\n'),
        status: 'verified',
        memoryType: 'decision',
        recordedAt: '2026-10-15T14:33:14.000Z',
        sourceEventId: 'event-m18-2',
      },
      {
        id: 'milestone-m18-1',
        projectId,
        title: 'M18.1 CURSOR BOOTSTRAP MERGED — PR #102',
        content: [
          'PR: https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/102',
          'Merge SHA: 2222222222222222222222222222222222222222',
        ].join('\n'),
        status: 'verified',
        memoryType: 'decision',
        recordedAt: '2026-10-14T14:33:14.000Z',
        sourceEventId: 'event-m18-1',
      },
      {
        id: 'milestone-m17-6',
        projectId,
        title: 'M17.6 GRAPH FUSION MERGED — PR #101',
        content: [
          'PR: https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/101',
          'Merge SHA: 1111111111111111111111111111111111111111',
        ].join('\n'),
        status: 'verified',
        memoryType: 'decision',
        recordedAt: '2026-10-13T14:33:14.000Z',
        sourceEventId: 'event-m17-6',
      },
    ],
    tasks: [
      {
        id: 'task-m18-3',
        projectId,
        title: 'Implement M18.3 ROMA integration',
        content: 'Private implementation notes must not be copied.',
        status: 'active',
        memoryType: 'task',
        recordedAt: '2026-10-15T14:34:00.000Z',
        sourceEventId: 'event-task-m18-3',
      },
      {
        id: 'task-release-audit',
        projectId,
        title: 'Audit release evidence',
        content: 'Private release audit notes must not be copied.',
        status: 'active',
        memoryType: 'task',
        recordedAt: '2026-10-15T14:32:00.000Z',
        sourceEventId: 'event-task-release-audit',
      },
      {
        id: 'task-owner-review',
        projectId,
        title: 'Review release ownership',
        content: 'Private owner review notes must not be copied.',
        status: 'active',
        memoryType: 'task',
        recordedAt: '2026-10-15T14:31:00.000Z',
        sourceEventId: 'event-task-owner-review',
      },
    ],
    facts: [],
    state: {
      id: 'project-state-m18-3',
      projectId,
      version: 8,
      summary: 'M18.3 is active with a release gate.',
      updatedAt: '2026-10-15T14:35:00.000Z',
      state: {
        stage: 'm18-3',
        risks: ['Release evidence could become stale.'],
        next: ['Complete M18.3 ROMA integration.'],
      },
    },
    latestHandoff: {
      id: 'handoff-m18-3',
      projectId,
      createdAt: '2026-10-15T14:34:30.000Z',
      payload: { summary: 'M18.2 handed off to ROMA integration.' },
    },
  };
}

function candidateGetMemory() {
  return vi.fn(async ({ memoryId }: { memoryId: string }) => ({
    id: memoryId,
    title: 'ROMA candidate memory',
    content: 'candidate outcome',
    status: 'candidate',
    sensitivity: 'internal',
    memoryType: 'fact',
    projectId,
    workspaceId,
    recordedAt: '2026-10-15T14:35:00.000Z',
    createdBySubject: roma,
    metadata: { needs_review: true },
  }));
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
            id: 'task-slice-01',
            title: 'Implement Slice 01',
            content: 'Task body must not be copied verbatim.',
            status: 'active',
            recordedAt: '2026-08-20T02:00:00.000Z',
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
      getMemory: candidateGetMemory(),
      appendAuditEvent,
      completeRomaProjectHealth,
    };

    const result = await runRomaProjectHealthJob({
      gateway: gateway as any,
      job: buildJob(),
      romaSubjectId: roma,
    });

    expect(result.memoryId).toBe('memory-roma-1');
    expect(result.notificationSeverity).toBe('info');
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
        notificationTitle: 'ROMA project health updated: AISTROYKA',
        notificationSeverity: 'info',
        notificationSourceMemoryIds: ['memory-roma-1'],
        notificationMetadata: expect.objectContaining({
          projectId,
          sourceJobId: 'job-roma-1',
          summaryTitle: 'ROMA project health: AISTROYKA',
        }),
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
    expect(captureInput?.text).toContain('Implement Slice 01');
    expect(captureInput?.text).not.toContain(
      'Task body must not be copied verbatim.',
    );
    expect(captureInput?.text).not.toContain(
      'Decision body must not be copied verbatim.',
    );
    expect(captureInput?.text).toContain(
      'titles and structured state only; raw memory bodies are not quoted',
    );
    expect(captureInput?.provenance?.automation?.requestedBy).toBe(owner);
    expect(captureInput?.metadata?.summary_type).toBe('project_health');
  });

  it('fails closed when succeeded completion loses ROMA notification ACL', async () => {
    const captureConnectorRecord = vi.fn(async () => ({
      eventId: 'source-roma-1',
      process: { memoryId: 'memory-roma-1' },
    }));
    const appendAuditEvent = vi.fn(async () => ({ id: 'audit-roma-1' }));
    const completeRomaProjectHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error('roma project access required'))
      .mockResolvedValueOnce({
        jobId: 'job-roma-1',
        status: 'failed',
      });
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
        decisions: [],
        tasks: [],
        facts: [],
        state: null,
        latestHandoff: null,
      })),
      captureConnectorRecord,
      getMemory: candidateGetMemory(),
      appendAuditEvent,
      completeRomaProjectHealth,
    };

    await expect(
      runRomaProjectHealthJob({
        gateway: gateway as any,
        job: buildJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/roma project access required/i);

    expect(completeRomaProjectHealth).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        subjectId: roma,
        status: 'succeeded',
        notificationTitle: 'ROMA project health updated: AISTROYKA',
      }),
    );
    expect(completeRomaProjectHealth).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        subjectId: roma,
        status: 'failed',
        error: 'roma project access required',
      }),
    );
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

  it('fails closed when the action budget blocks the write before any memory lands', async () => {
    const captureConnectorRecord = vi.fn(async () => ({
      error:
        'roma action budget exceeded for project 44444444-4444-4444-8444-444444444401 (1 writes per 60 minutes)',
      budgetAuditEventId: 'audit-budget-1',
    }));
    const completeRomaProjectHealth = vi.fn(async () => ({
      jobId: 'job-roma-1',
      status: 'failed',
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
        decisions: [],
        tasks: [],
        facts: [],
        state: null,
        latestHandoff: null,
      })),
      captureConnectorRecord,
      appendAuditEvent: vi.fn(),
      completeRomaProjectHealth,
    };

    await expect(
      runRomaProjectHealthJob({
        gateway: gateway as any,
        job: buildJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/action budget exceeded/i);

    expect(gateway.appendAuditEvent).not.toHaveBeenCalled();
    expect(completeRomaProjectHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-roma-1',
        status: 'failed',
        error: expect.stringMatching(/action budget exceeded/i),
      }),
    );
  });
});

describe('runRomaProjectFindingsJob', () => {
  it('writes bounded QA findings as ROMA without quoting raw memory bodies', async () => {
    const captureConnectorRecord = vi.fn(async (input: Record<string, any>) => ({
      eventId: `source-${input.metadata.finding_key}`,
      process: { memoryId: `memory-${input.metadata.finding_key}` },
    }));
    const appendAuditEvent = vi.fn(async ({ afterState }: Record<string, any>) => ({
      id: `audit-${afterState.findingKey}`,
    }));
    const completeRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
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
            id: 'decision-1',
            title: 'Kickoff order',
            content: 'Decision body must not be copied verbatim.',
            memoryType: 'decision',
          },
        ],
        tasks: [
          {
            id: 'task-1',
            title: 'Resolve blocked deploy',
            content: 'Task body must not be copied verbatim.',
            memoryType: 'task',
          },
        ],
        facts: [
          {
            id: 'fact-1',
            title: 'Risk register refreshed',
            content: 'Confidential finance note that must never be quoted.',
            memoryType: 'fact',
          },
        ],
        state: {
          version: 3,
          summary: 'Delivery is blocked by deployment access.',
          state: {
            stage: 'slice-03',
            completed: ['slice-02'],
            blocked: ['deployment access'],
            next: ['restore deploy access'],
            risks: ['release window may slip'],
          },
        },
        latestHandoff: null,
      })),
      captureConnectorRecord,
      getMemory: candidateGetMemory(),
      appendAuditEvent,
      completeRomaProjectFindings,
    };

    const result = await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });

    expect(result.findingCount).toBeGreaterThan(0);
    expect(result.notificationSeverity).toBe('medium');
    expect(captureConnectorRecord).toHaveBeenCalled();
    expect(appendAuditEvent).toHaveBeenCalled();
    expect(completeRomaProjectFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-findings-1',
        status: 'succeeded',
        findingCount: result.findingCount,
        notificationTitle: 'ROMA QA findings: AISTROYKA (3 open)',
        notificationSeverity: 'medium',
        notificationSourceMemoryIds: [
          'memory-blocked-work',
          'memory-active-risks',
          'memory-missing-handoff',
        ],
        notificationMetadata: expect.objectContaining({
          projectId,
          sourceJobId: 'job-findings-1',
          findingCount: 3,
          findingKeys: ['blocked-work', 'active-risks', 'missing-handoff'],
        }),
      }),
    );

    const captureInputs = captureConnectorRecord.mock.calls.map(
      (call) => call[0] as Record<string, any>,
    );
    for (const input of captureInputs) {
      expect(input.subjectId).toBe(roma);
      expect(input.subjectId).not.toBe(owner);
      expect(input.text).not.toContain('Confidential finance note that must never be quoted.');
      expect(input.text).toContain('source IDs/titles only');
      expect(input.metadata.summary_type).toBe('qa_finding');
      expect(Array.isArray(input.metadata.evidence_refs)).toBe(true);
      expect(input.provenance.automation.executionSubjectId).toBe(roma);
    }
  });

  it('preserves snake_case memory_type values in finding evidence refs', async () => {
    const captureConnectorRecord = vi.fn(async (input: Record<string, any>) => ({
      eventId: `source-${input.metadata.finding_key}`,
      process: { memoryId: `memory-${input.metadata.finding_key}` },
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
        decisions: [],
        tasks: [
          {
            id: 'task-snake-1',
            title: 'Resolve blocked deploy',
            memory_type: 'task',
          },
        ],
        facts: [],
        state: {
          version: 3,
          summary: 'Delivery is blocked by deployment access.',
          state: {
            blocked: ['deployment access'],
            next: ['restore deploy access'],
            risks: [],
          },
        },
        latestHandoff: null,
      })),
      captureConnectorRecord,
      getMemory: candidateGetMemory(),
      appendAuditEvent: vi.fn(async ({ afterState }: Record<string, any>) => ({
        id: `audit-${afterState.findingKey}`,
      })),
      completeRomaProjectFindings: vi.fn(async () => ({
        jobId: 'job-findings-1',
        status: 'succeeded',
      })),
    };

    await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });

    const blockedFinding = captureConnectorRecord.mock.calls.find(
      (call) => call[0]?.metadata?.finding_key === 'blocked-work',
    )?.[0] as Record<string, any> | undefined;
    expect(blockedFinding).toBeTruthy();
    expect(blockedFinding?.metadata?.evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'memory',
          memoryId: 'task-snake-1',
          memoryType: 'task',
        }),
      ]),
    );
  });

  it('reuses stable finding idempotency keys for identical reruns', async () => {
    const captureConnectorRecord = vi.fn(async (input: Record<string, any>) => ({
      eventId: `source-${input.idempotencyKey}`,
      process: { memoryId: `memory-${input.idempotencyKey}` },
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
        decisions: [],
        tasks: [],
        facts: [],
        state: {
          version: 1,
          summary: '',
          state: {
            blocked: [],
            next: [],
            risks: [],
          },
        },
        latestHandoff: null,
      })),
      captureConnectorRecord,
      getMemory: candidateGetMemory(),
      appendAuditEvent: vi.fn(async ({ afterState }: Record<string, any>) => ({
        id: `audit-${afterState.findingKey}`,
      })),
      completeRomaProjectFindings: vi.fn(async () => ({
        jobId: 'job-findings-1',
        status: 'succeeded',
      })),
    };

    await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });
    await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });

    const firstKeys = captureConnectorRecord.mock.calls
      .slice(0, captureConnectorRecord.mock.calls.length / 2)
      .map((call) => call[0]?.idempotencyKey);
    const secondKeys = captureConnectorRecord.mock.calls
      .slice(captureConnectorRecord.mock.calls.length / 2)
      .map((call) => call[0]?.idempotencyKey);
    expect(secondKeys).toEqual(firstKeys);
  });

  it('consumes the M18.2 pack, links release evidence, and keeps claims candidate-only', async () => {
    const captureConnectorRecord = vi.fn(async (input: Record<string, any>) => ({
      eventId: `source-${input.idempotencyKey}`,
      process: {
        memoryId: `memory-${input.idempotencyKey}`,
        status: 'candidate',
      },
    }));
    const projectContext = vi.fn(async () => buildReleaseContext());
    const getMemory = vi.fn(async ({ memoryId }: { memoryId: string }) => ({
      id: memoryId,
      title: 'ROMA QA finding',
      content: 'candidate outcome',
      status: 'candidate',
      sensitivity: 'internal',
      memoryType: 'fact',
      projectId,
      workspaceId,
      recordedAt: '2026-10-15T14:35:00.000Z',
      createdBySubject: roma,
      metadata: { needs_review: true },
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
      projectContext,
      captureConnectorRecord,
      getMemory,
      appendAuditEvent: vi.fn(async ({ afterState }: Record<string, any>) => ({
        id: `audit-${afterState.findingKey}`,
      })),
      completeRomaProjectFindings: vi.fn(async () => ({
        jobId: 'job-findings-1',
        status: 'succeeded',
      })),
    };

    const first = await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });
    const second = await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });

    expect(projectContext).toHaveBeenCalledWith(roma, projectId);
    expect(getMemory).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: roma }),
    );
    expect(first.findings.map((finding) => finding.idempotencyKey)).toEqual(
      second.findings.map((finding) => finding.idempotencyKey),
    );
    const releaseRisk = captureConnectorRecord.mock.calls
      .map((call) => call[0] as Record<string, any>)
      .find((input) => input.metadata?.outcome_type === 'release_risk');
    expect(releaseRisk).toBeTruthy();
    expect(releaseRisk?.metadata).toMatchObject({
      roma_integration_pack: 'm18-s03-v1',
      project_context_pack: 'm18-s02-v1',
      canonical_status: 'candidate',
      requires_review: true,
      auto_verify_allowed: false,
      confidence: 0.6,
    });
    expect(releaseRisk?.metadata?.release_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          releaseType: 'pull_request',
          value: 'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/103',
        }),
        expect.objectContaining({
          releaseType: 'commit',
          value: '49d051c436fd2a4fbe9d7f64661edb0b3880aaa0',
        }),
        expect.objectContaining({
          releaseType: 'deployment',
          value: 'milestone-m18-2',
        }),
      ]),
    );
    expect(releaseRisk?.metadata?.release_refs).toHaveLength(6);
    expect(releaseRisk?.metadata?.evidence_refs).toHaveLength(12);
    expect(releaseRisk?.metadata?.evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'release',
          releaseType: 'deployment',
          value: 'milestone-m18-2',
        }),
      ]),
    );
    expect(releaseRisk?.externalVersion).toMatch(/^[a-f0-9]{24}$/);
    expect(releaseRisk?.text).toContain('Canonical status: candidate');
    expect(releaseRisk?.text).toContain('cannot silently become verified');
    expect(releaseRisk?.text).not.toContain('Private implementation notes');
    for (const call of captureConnectorRecord.mock.calls) {
      expect(call[0]?.text).not.toContain(
        'Private deployment credential detail must not be copied.',
      );
    }

    projectContext.mockResolvedValueOnce(
      buildReleaseContext('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );
    await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob({ jobId: 'job-findings-2' }),
      romaSubjectId: roma,
    });
    const changedReleaseRisk = captureConnectorRecord.mock.calls
      .slice(-2)
      .map((call) => call[0] as Record<string, any>)
      .find((input) => input.metadata?.outcome_type === 'release_risk');
    expect(changedReleaseRisk?.externalVersion).not.toBe(
      releaseRisk?.externalVersion,
    );

    projectContext.mockResolvedValueOnce(
      buildReleaseContext(
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        {
          milestoneTitle: 'M18.3 production deployment pending',
          deploymentLine: 'Production deployment is pending review.',
        },
      ),
    );
    await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob({ jobId: 'job-findings-3' }),
      romaSubjectId: roma,
    });
    const pendingReleaseRefs = captureConnectorRecord.mock.calls
      .slice(-2)
      .flatMap((call) => call[0]?.metadata?.release_refs ?? []);
    expect(pendingReleaseRefs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ releaseType: 'deployment' }),
      ]),
    );
  });

  it('prioritizes stale release risk and attaches freshness evidence', async () => {
    const captureConnectorRecord = vi.fn(async (input: Record<string, any>) => ({
      eventId: `source-${input.metadata.finding_key}`,
      process: { memoryId: `memory-${input.metadata.finding_key}` },
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
        decisions: [],
        tasks: [],
        facts: [
          {
            id: 'fact-old-signal',
            projectId,
            title: 'Last known QA signal',
            content: 'Private stale fact body must not be copied.',
            status: 'verified',
            memoryType: 'fact',
            recordedAt: '2020-01-02T00:00:00.000Z',
          },
        ],
        state: {
          id: 'state-old',
          projectId,
          version: 1,
          summary: '',
          updatedAt: '2020-01-01T00:00:00.000Z',
          state: {},
        },
        latestHandoff: null,
      })),
      captureConnectorRecord,
      getMemory: candidateGetMemory(),
      appendAuditEvent: vi.fn(async ({ afterState }: Record<string, any>) => ({
        id: `audit-${afterState.findingKey}`,
      })),
      completeRomaProjectFindings: vi.fn(async () => ({
        jobId: 'job-findings-stale',
        status: 'succeeded',
      })),
    };

    const result = await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob({ jobId: 'job-findings-stale' }),
      romaSubjectId: roma,
    });

    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]).toMatchObject({
      findingKey: 'stale-release-context',
      severity: 'high',
    });
    const staleInput = captureConnectorRecord.mock.calls
      .map((call) => call[0] as Record<string, any>)
      .find((input) => input.metadata?.finding_key === 'stale-release-context');
    expect(staleInput?.metadata?.release_refs).toEqual([]);
    expect(staleInput?.metadata?.evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'memory',
          memoryId: 'fact-old-signal',
          title: 'Last known QA signal',
          field: 'sourceFreshness',
        }),
      ]),
    );
    expect(staleInput?.text).not.toContain(
      'Private stale fact body must not be copied.',
    );
  });

  it('fails closed if a ROMA outcome is promoted during read-after-write', async () => {
    const appendAuditEvent = vi.fn();
    const completeRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
      status: 'failed',
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
      projectContext: vi.fn(async () => buildReleaseContext()),
      captureConnectorRecord: vi.fn(async () => ({
        eventId: 'source-promoted',
        process: { memoryId: 'memory-promoted' },
      })),
      getMemory: vi.fn(async () => ({
        id: 'memory-promoted',
        title: 'ROMA promoted finding',
        content: 'must fail closed',
        status: 'verified',
        sensitivity: 'internal',
        memoryType: 'fact',
        projectId,
        workspaceId,
        recordedAt: '2026-10-15T14:35:00.000Z',
        createdBySubject: roma,
        metadata: {},
      })),
      appendAuditEvent,
      completeRomaProjectFindings,
    };

    await expect(
      runRomaProjectFindingsJob({
        gateway: gateway as any,
        job: buildFindingsJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/must remain a project-scoped candidate/i);
    expect(appendAuditEvent).not.toHaveBeenCalled();
    expect(completeRomaProjectFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringMatching(/must remain a project-scoped candidate/i),
      }),
    );
  });

  it('fails the findings job when the project is not visible to ROMA', async () => {
    const completeRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
      status: 'failed',
    }));
    const gateway = {
      listProjects: vi.fn(async () => []),
      projectContext: vi.fn(),
      captureConnectorRecord: vi.fn(),
      appendAuditEvent: vi.fn(),
      completeRomaProjectFindings,
    };

    await expect(
      runRomaProjectFindingsJob({
        gateway: gateway as any,
        job: buildFindingsJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/not visible to ROMA/i);

    expect(completeRomaProjectFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-findings-1',
        status: 'failed',
      }),
    );
  });

  it('produces no finding memory when the action budget rejects the write', async () => {
    const captureConnectorRecord = vi.fn(async () => ({
      error:
        'roma action budget not configured for project 44444444-4444-4444-8444-444444444401',
      budgetAuditEventId: 'audit-budget-1',
    }));
    const completeRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
      status: 'failed',
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
        decisions: [],
        tasks: [],
        facts: [],
        state: {
          version: 3,
          summary: 'Delivery is blocked by deployment access.',
          state: {
            blocked: ['deployment access'],
            next: ['restore deploy access'],
            risks: [],
          },
        },
        latestHandoff: null,
      })),
      captureConnectorRecord,
      appendAuditEvent: vi.fn(),
      completeRomaProjectFindings,
    };

    await expect(
      runRomaProjectFindingsJob({
        gateway: gateway as any,
        job: buildFindingsJob(),
        romaSubjectId: roma,
      }),
    ).rejects.toThrow(/budget not configured/i);

    expect(gateway.appendAuditEvent).not.toHaveBeenCalled();
    expect(completeRomaProjectFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-findings-1',
        status: 'failed',
        error: expect.stringMatching(/budget not configured/i),
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
      getMemory: candidateGetMemory(),
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

describe('runRomaProjectFindingsTick', () => {
  it('requeues a retryable findings failure instead of consuming the request', async () => {
    const retryRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
      status: 'queued',
      attempt: 1,
      jobType: 'roma_project_findings',
      error: 'temporary qa outage',
    }));
    const completeRomaProjectFindings = vi.fn(async () => ({
      jobId: 'job-findings-1',
      status: 'failed',
    }));
    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      listOutboxPending: vi.fn(async () => ({ count: 1 })),
      claimRomaProjectFindingsJobs: vi.fn(async () => ({
        count: 1,
        jobs: [buildFindingsJob({ attempt: 0 })],
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
        throw new Error('temporary qa outage');
      }),
      appendAuditEvent: vi.fn(),
      completeRomaProjectFindings,
      retryRomaProjectFindings,
    };

    const report = await runRomaProjectFindingsTick({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(retryRomaProjectFindings).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: roma,
        jobId: 'job-findings-1',
        error: 'temporary qa outage',
      }),
    );
    expect(completeRomaProjectFindings).not.toHaveBeenCalled();
    expect(report.pendingOutbox).toBe(1);
  });
});

describe('buildRomaQaFindingApprovalCheckpointRequest', () => {
  it('keeps approval payloads bounded to titles, ids, and reason only', async () => {
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
        decisions: [],
        tasks: [
          {
            id: 'task-1',
            title: 'Fix blocked deployment',
            content: 'Private escalation thread body that must never be quoted.',
            memoryType: 'task',
          },
        ],
        facts: [],
        state: {
          version: 7,
          summary: 'Blocked deployment needs owner attention.',
          state: {
            blocked: [
              'Production deploy is blocked on owner approval.',
              'Incident thread includes personal contact details.',
            ],
            risks: [],
            next: ['Resolve deploy gate'],
          },
        },
        latestHandoff: null,
      })),
      captureConnectorRecord: vi.fn(async (_input: Record<string, any>) => ({
        eventId: 'source-findings-1',
        process: { memoryId: 'memory-findings-1' },
      })),
      getMemory: candidateGetMemory(),
      appendAuditEvent: vi.fn(async () => ({ id: 'audit-findings-1' })),
      completeRomaProjectFindings: vi.fn(async () => ({
        jobId: 'job-findings-1',
        status: 'succeeded',
      })),
    };

    const result = await runRomaProjectFindingsJob({
      gateway: gateway as any,
      job: buildFindingsJob(),
      romaSubjectId: roma,
    });
    const highSeverity = result.findings.find((entry) => entry.severity === 'high');
    expect(highSeverity).toBeTruthy();

    const checkpoint = buildRomaQaFindingApprovalCheckpointRequest({
      job: buildFindingsJob(),
      finding: {
        key: 'blocked-work',
        title: 'Blocked work requires review',
        summary:
          'Project state lists blocked work items, so ROMA flagged follow-up that may stall delivery.',
        severity: 'high',
        status: 'open',
        outcomeType: 'release_risk',
        confidence: 0.6,
        canonicalStatus: 'candidate',
        requiresReview: true,
        evidenceRefs: [
          {
            kind: 'project_state',
            stateVersion: 7,
            field: 'blocked',
            titles: [
              'Production deploy is blocked on owner approval.',
              'Incident thread includes personal contact details.',
            ],
          },
          {
            kind: 'memory',
            memoryId: 'task-1',
            memoryType: 'task',
            title: 'Fix blocked deployment',
          },
        ],
      },
    });

    expect(checkpoint.idempotencyKey).toContain(projectId);
    expect(JSON.stringify(checkpoint)).toContain('Fix blocked deployment');
    expect(JSON.stringify(checkpoint)).not.toContain(
      'Private escalation thread body that must never be quoted.',
    );
    expect(JSON.stringify(checkpoint)).not.toContain('"content"');
    expect(checkpoint.reason).toBe('Generate bounded ROMA QA findings.');
  });
});

describe('runRomaAutomationOnce', () => {
  it('uses the canonical ROMA subject when the optional workflow secret is blank', () => {
    expect(resolveRomaSubjectId({ MEMORY_OS_ROMA_SUBJECT_ID: '' })).toBe(roma);
    expect(resolveRomaSubjectId({ MEMORY_OS_ROMA_SUBJECT_ID: '   ' })).toBe(roma);
    expect(
      resolveRomaSubjectId({ MEMORY_OS_ROMA_SUBJECT_ID: `  ${owner}  ` }),
    ).toBe(owner);
  });

  it('preserves structured Supabase error messages instead of object coercion', async () => {
    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      claimRomaProjectFindingsJobs: vi.fn(async () => {
        throw {
          message: 'invalid input syntax for type uuid',
          code: '22P02',
        };
      }),
      tickRomaProjectHealthSchedules: vi.fn(async () => {
        throw {
          message: 'roma subject required',
          code: '42501',
        };
      }),
    };

    const report = await runRomaAutomationOnce({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(report.qaFindings.error).toBe(
      'invalid input syntax for type uuid (22P02)',
    );
    expect(report.projectHealth.error).toBe('roma subject required (42501)');
    expect(report.qaFindings.error).not.toContain('[object Object]');
    expect(report.projectHealth.error).not.toContain('[object Object]');
  });

  it('still runs the health tick when the findings tick throws', async () => {
    const tickRomaProjectHealthSchedules = vi.fn(async () => ({
      count: 1,
      enqueued: [],
      disabled: [],
      errors: [],
    }));
    const claimRomaProjectHealthJobs = vi.fn(async () => ({ count: 0, jobs: [] }));
    const gateway = {
      deadLetterStaleJobs: vi.fn(async () => ({ deadLettered: 0 })),
      claimRomaProjectFindingsJobs: vi.fn(async () => {
        throw new Error('missing findings rpc');
      }),
      listOutboxPending: vi.fn(async ({ eventType }: Record<string, any>) => ({
        count: eventType === 'roma.project_health.requested' ? 0 : 0,
      })),
      listProjects: vi.fn(),
      projectContext: vi.fn(),
      captureConnectorRecord: vi.fn(),
      appendAuditEvent: vi.fn(),
      completeRomaProjectFindings: vi.fn(),
      retryRomaProjectFindings: vi.fn(),
      tickRomaProjectHealthSchedules,
      claimRomaProjectHealthJobs,
      completeRomaProjectHealth: vi.fn(),
      retryRomaProjectHealth: vi.fn(),
    };

    const report = await runRomaAutomationOnce({
      gateway: gateway as any,
      workspaceId,
      romaSubjectId: roma,
    });

    expect(report.qaFindings.error).toMatch(/missing findings rpc/i);
    expect(report.qaFindings.claimed).toBe(0);
    expect(report.projectHealth.error).toBeNull();
    expect(tickRomaProjectHealthSchedules).toHaveBeenCalledWith({
      subjectId: roma,
      workspaceId,
      limit: 10,
      projectId: null,
    });
    expect(claimRomaProjectHealthJobs).toHaveBeenCalled();
  });
});

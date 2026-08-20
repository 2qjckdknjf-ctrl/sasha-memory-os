import { describe, expect, it, vi } from 'vitest';
import { SupabaseMemoryGateway } from './gateway.js';

describe('SupabaseMemoryGateway.upsertRomaProjectHealthSchedule', () => {
  it('omits enabled and reason RPC args when they are not provided', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const gateway = new SupabaseMemoryGateway({ rpc } as any, 'test-secret');

    await gateway.upsertRomaProjectHealthSchedule({
      subjectId: '33333333-3333-4333-8333-333333333303',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId: '44444444-4444-4444-8444-444444444401',
      cadenceMinutes: 720,
    });

    expect(rpc).toHaveBeenCalledWith(
      'api_upsert_roma_project_health_schedule',
      expect.objectContaining({
        p_secret: 'test-secret',
        p_subject_id: '33333333-3333-4333-8333-333333333303',
        p_workspace_id: '11111111-1111-4111-8111-111111111111',
        p_project_id: '44444444-4444-4444-8444-444444444401',
        p_cadence_minutes: 720,
      }),
    );
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect('p_enabled' in args).toBe(false);
    expect('p_reason' in args).toBe(false);
  });

  it('passes explicit enabled and reason RPC args when provided', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const gateway = new SupabaseMemoryGateway({ rpc } as any, 'test-secret');

    await gateway.upsertRomaProjectHealthSchedule({
      subjectId: '33333333-3333-4333-8333-333333333303',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId: '44444444-4444-4444-8444-444444444401',
      cadenceMinutes: 720,
      enabled: false,
      reason: 'Keep disabled.',
    });

    expect(rpc).toHaveBeenCalledWith(
      'api_upsert_roma_project_health_schedule',
      expect.objectContaining({
        p_enabled: false,
        p_reason: 'Keep disabled.',
      }),
    );
  });
});

describe('SupabaseMemoryGateway.enqueueRomaProjectFindings', () => {
  it('passes bounded enqueue RPC args for one explicit project', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const gateway = new SupabaseMemoryGateway({ rpc } as any, 'test-secret');

    await gateway.enqueueRomaProjectFindings({
      subjectId: '33333333-3333-4333-8333-333333333304',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId: '44444444-4444-4444-8444-444444444401',
      idempotencyKey: 'slice-03',
      reason: 'Generate bounded ROMA QA findings.',
    });

    expect(rpc).toHaveBeenCalledWith(
      'api_enqueue_roma_project_findings',
      expect.objectContaining({
        p_secret: 'test-secret',
        p_subject_id: '33333333-3333-4333-8333-333333333304',
        p_workspace_id: '11111111-1111-4111-8111-111111111111',
        p_project_id: '44444444-4444-4444-8444-444444444401',
        p_idempotency_key: 'slice-03',
        p_reason: 'Generate bounded ROMA QA findings.',
      }),
    );
  });
});

describe('SupabaseMemoryGateway.completeRomaProjectHealth', () => {
  it('passes notification RPC args for audited ROMA health completion', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const gateway = new SupabaseMemoryGateway({ rpc } as any, 'test-secret');

    await gateway.completeRomaProjectHealth({
      subjectId: '33333333-3333-4333-8333-333333333304',
      jobId: 'job-roma-1',
      status: 'succeeded',
      memoryId: 'memory-roma-1',
      auditEventId: 'audit-roma-1',
      notificationTitle: 'ROMA project health updated: AISTROYKA',
      notificationSeverity: 'info',
      notificationSourceMemoryIds: ['memory-roma-1'],
      notificationMetadata: {
        projectId: '44444444-4444-4444-8444-444444444401',
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      'api_complete_roma_project_health',
      expect.objectContaining({
        p_secret: 'test-secret',
        p_subject_id: '33333333-3333-4333-8333-333333333304',
        p_job_id: 'job-roma-1',
        p_status: 'succeeded',
        p_memory_id: 'memory-roma-1',
        p_audit_event_id: 'audit-roma-1',
        p_notification_title: 'ROMA project health updated: AISTROYKA',
        p_notification_severity: 'info',
        p_notification_source_memory_ids: ['memory-roma-1'],
        p_notification_metadata: {
          projectId: '44444444-4444-4444-8444-444444444401',
        },
      }),
    );
  });
});

describe('SupabaseMemoryGateway.completeRomaProjectFindings', () => {
  it('passes notification RPC args for audited ROMA findings completion', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const gateway = new SupabaseMemoryGateway({ rpc } as any, 'test-secret');

    await gateway.completeRomaProjectFindings({
      subjectId: '33333333-3333-4333-8333-333333333304',
      jobId: 'job-findings-1',
      status: 'succeeded',
      memoryId: 'memory-blocked-work',
      auditEventId: 'audit-blocked-work',
      findingCount: 2,
      notificationTitle: 'ROMA QA findings: AISTROYKA (2 open)',
      notificationSeverity: 'high',
      notificationSourceMemoryIds: ['memory-blocked-work', 'memory-active-risks'],
      notificationMetadata: {
        projectId: '44444444-4444-4444-8444-444444444401',
        findingKeys: ['blocked-work', 'active-risks'],
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      'api_complete_roma_project_findings',
      expect.objectContaining({
        p_secret: 'test-secret',
        p_subject_id: '33333333-3333-4333-8333-333333333304',
        p_job_id: 'job-findings-1',
        p_status: 'succeeded',
        p_memory_id: 'memory-blocked-work',
        p_audit_event_id: 'audit-blocked-work',
        p_finding_count: 2,
        p_notification_title: 'ROMA QA findings: AISTROYKA (2 open)',
        p_notification_severity: 'high',
        p_notification_source_memory_ids: ['memory-blocked-work', 'memory-active-risks'],
        p_notification_metadata: {
          projectId: '44444444-4444-4444-8444-444444444401',
          findingKeys: ['blocked-work', 'active-risks'],
        },
      }),
    );
  });
});

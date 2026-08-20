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

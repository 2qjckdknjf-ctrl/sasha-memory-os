import { describe, expect, it } from 'vitest';
import {
  enqueueRomaProjectHealthJobSchema,
  processingJobTypeSchema,
  upsertRomaProjectHealthScheduleSchema,
} from './jobs.js';

describe('processingJobTypeSchema', () => {
  it('accepts the ROMA project-health job type', () => {
    expect(processingJobTypeSchema.parse('roma_project_health')).toBe(
      'roma_project_health',
    );
  });
});

describe('enqueueRomaProjectHealthJobSchema', () => {
  it('requires an explicit project_id', () => {
    expect(() =>
      enqueueRomaProjectHealthJobSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        reason: 'Generate one audited summary.',
      }),
    ).toThrow();
  });

  it('accepts a bounded enqueue payload', () => {
    const parsed = enqueueRomaProjectHealthJobSchema.parse({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      idempotency_key: 'slice-01',
      reason: 'Generate one audited summary.',
    });
    expect(parsed.project_id).toBe('44444444-4444-4444-8444-444444444401');
  });
});

describe('upsertRomaProjectHealthScheduleSchema', () => {
  it('requires an explicit project_id and actor_subject_id', () => {
    expect(() =>
      upsertRomaProjectHealthScheduleSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        cadence_minutes: 60,
      }),
    ).toThrow();
  });

  it('rejects slug-like project references so a default project is never inferred', () => {
    expect(() =>
      upsertRomaProjectHealthScheduleSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        project_id: 'aistroyka',
        actor_subject_id: '33333333-3333-4333-8333-333333333303',
        cadence_minutes: 60,
      }),
    ).toThrow();
  });

  it('accepts a bounded schedule payload for one explicit project', () => {
    const parsed = upsertRomaProjectHealthScheduleSchema.parse({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333303',
      cadence_minutes: 720,
      enabled: true,
      next_run_at: '2026-08-20T02:00:00.000Z',
      reason: 'Scheduled ROMA health summary.',
    });
    expect(parsed.project_id).toBe('44444444-4444-4444-8444-444444444401');
    expect(parsed.cadence_minutes).toBe(720);
  });
});

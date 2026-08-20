import { describe, expect, it } from 'vitest';
import {
  enqueueRomaProjectFindingsJobSchema,
  enqueueRomaProjectHealthJobSchema,
  processingJobTypeSchema,
  upsertRomaActionBudgetSchema,
  upsertRomaProjectHealthScheduleSchema,
} from './jobs.js';

describe('processingJobTypeSchema', () => {
  it('accepts the ROMA automation job types', () => {
    expect(processingJobTypeSchema.parse('roma_project_health')).toBe('roma_project_health');
    expect(processingJobTypeSchema.parse('roma_project_findings')).toBe(
      'roma_project_findings',
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

describe('enqueueRomaProjectFindingsJobSchema', () => {
  it('requires an explicit project_id', () => {
    expect(() =>
      enqueueRomaProjectFindingsJobSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        actor_subject_id: '33333333-3333-4333-8333-333333333304',
        reason: 'Generate bounded ROMA QA findings.',
      }),
    ).toThrow();
  });

  it('accepts a bounded enqueue payload for one explicit project', () => {
    const parsed = enqueueRomaProjectFindingsJobSchema.parse({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333304',
      idempotency_key: 'slice-03',
      reason: 'Generate bounded ROMA QA findings.',
    });
    expect(parsed.project_id).toBe('44444444-4444-4444-8444-444444444401');
    expect(parsed.actor_subject_id).toBe('33333333-3333-4333-8333-333333333304');
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

describe('upsertRomaActionBudgetSchema', () => {
  it('requires an explicit project_id and actor_subject_id', () => {
    expect(() =>
      upsertRomaActionBudgetSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        max_actions: 5,
        window_minutes: 60,
      }),
    ).toThrow();
  });

  it('rejects slug-like project references so a default project is never inferred', () => {
    expect(() =>
      upsertRomaActionBudgetSchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        project_id: 'aistroyka',
        actor_subject_id: '33333333-3333-4333-8333-333333333301',
        max_actions: 5,
        window_minutes: 60,
      }),
    ).toThrow();
  });

  it('accepts a bounded per-project ROMA action budget payload', () => {
    const parsed = upsertRomaActionBudgetSchema.parse({
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      max_actions: 3,
      window_minutes: 1440,
      enabled: false,
    });
    expect(parsed.project_id).toBe('44444444-4444-4444-8444-444444444401');
    expect(parsed.max_actions).toBe(3);
    expect(parsed.window_minutes).toBe(1440);
    expect(parsed.enabled).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  enqueueRomaProjectHealthJobSchema,
  processingJobTypeSchema,
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

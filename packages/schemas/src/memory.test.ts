import { describe, expect, it } from 'vitest';
import { setMemoryPersonalizationSchema } from './memory.js';

describe('setMemoryPersonalizationSchema', () => {
  it('accepts a clear payload when pinned and importance_delta are omitted', () => {
    const parsed = setMemoryPersonalizationSchema.parse({
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      reason: 'Clear personalization by omission.',
    });
    expect(parsed.pinned).toBeUndefined();
    expect(parsed.importance_delta).toBeUndefined();
  });

  it('accepts a clear payload when pinned is false and importance_delta is null', () => {
    const parsed = setMemoryPersonalizationSchema.parse({
      project_id: '44444444-4444-4444-8444-444444444401',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      reason: 'Clear personalization with explicit null.',
      pinned: false,
      importance_delta: null,
    });
    expect(parsed.pinned).toBe(false);
    expect(parsed.importance_delta).toBeNull();
  });
});

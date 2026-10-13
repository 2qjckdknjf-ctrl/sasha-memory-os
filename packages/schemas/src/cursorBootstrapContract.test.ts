import { describe, expect, it } from 'vitest';
import {
  CURSOR_BOOTSTRAP_STEPS,
  OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK,
} from './cursorBootstrapContract';

describe('M18.1 Cursor bootstrap contract', () => {
  it('publishes the complete ordered A-G lifecycle', () => {
    expect(OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK.version).toBe('m18-s01-v1');
    expect(CURSOR_BOOTSTRAP_STEPS.map((step) => step.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
    ]);
  });

  it('fails closed on project scope and write verification', () => {
    expect(OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK.invariants).toMatchObject({
      explicitCanonicalProjectRequired: true,
      canonicalPlanSearchRequired: true,
      currentContextSearchRequired: true,
      mergeBeforeProductionChange: true,
      mergeBeforeMilestoneWrite: true,
      readAfterWriteRequired: true,
      noDefaultProjectFallback: true,
    });
  });
});

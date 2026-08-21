import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M14_1_BASELINE_MANIFEST_VERSION,
  validateCurrentStateDrift,
} from './currentStateDrift';

describe('M14.1 CURRENT_STATE drift check', () => {
  it('passes against the reconciled repository snapshot', () => {
    const report = validateCurrentStateDrift();
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('publishes the official baseline manifest version constant', () => {
    expect(OFFICIAL_M14_1_BASELINE_MANIFEST_VERSION).toBe('m14.1-v1');
  });
});

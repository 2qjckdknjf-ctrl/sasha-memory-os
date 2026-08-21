import { describe, expect, it } from 'vitest';
import {
  M15_LIVE_E2E_CHECKS,
  OFFICIAL_M15_LIVE_E2E_GATE_PACK,
  OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION,
  summarizeM15LiveE2EGate,
} from './m15LiveE2EGate.js';

describe('M15 live E2E exit gate', () => {
  it('records overall BLOCKED and never claims PASS from mocks', () => {
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION).toBe('m15-live-e2e-v1');
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK.overallStatus).toBe('BLOCKED');
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK.claimPassFromMocks).toBe(false);
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK.invariants.neverClaimLiveE2EPassFromMocks).toBe(
      true,
    );
    expect(M15_LIVE_E2E_CHECKS.every((c) => c.status === 'BLOCKED')).toBe(true);
  });

  it('allows documented-limitation advance to M16.1', () => {
    const summary = summarizeM15LiveE2EGate();
    expect(summary.overallStatus).toBe('BLOCKED');
    expect(summary.mayAdvanceWithDocumentedLimitations).toBe(true);
    expect(summary.routedNextMilestone).toBe(
      'M16.1-apple-capability-feasibility-matrix',
    );
    expect(summary.blockedCount).toBe(M15_LIVE_E2E_CHECKS.length);
  });
});

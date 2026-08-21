import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK,
  OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION,
} from './connectorOrchestration.js';

describe('M15.2 connector orchestration pack schema', () => {
  it('publishes versioned recovery contract without claiming live E2E PASS', () => {
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION).toBe('m15-s02-v1');
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.version).toBe('m15-s02-v1');
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.recoveryScenarios).toEqual([
      'connector_restart',
      'duplicate_event',
      'missed_webhook',
      'token_expiry',
    ]);
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.invariants).toMatchObject({
      reuseExistingDlqReplayResync: true,
      noSilentDataLossOnRecovery: true,
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
      allowMemoryOsDefaultProjectIdFallback: false,
    });
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.liveE2E.statusInThisSlice).toBe(
      'blocked_missing_live_credentials',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M20_RELIABILITY_DR_GATE_PACK,
  OFFICIAL_M20_RELIABILITY_DR_GATE_PACK_VERSION,
} from './reliabilityDrGate.js';

describe('M20.2 reliability and DR gate pack', () => {
  it('freezes the accepted RPO/RTO targets and fail-closed recovery invariants', () => {
    expect(OFFICIAL_M20_RELIABILITY_DR_GATE_PACK_VERSION).toBe('m20-s02-v1');
    expect(OFFICIAL_M20_RELIABILITY_DR_GATE_PACK.targets).toEqual({
      databaseRpoHoursWithoutPitr: 24,
      databaseRpoMinutesWithPitr: 15,
      archivedObjectRpoHours: 24,
      privateBetaRtoHours: 8,
    });
    expect(OFFICIAL_M20_RELIABILITY_DR_GATE_PACK.invariants).toMatchObject({
      databaseAndStorageContoursIndependent: true,
      restoreTargetMustBeIsolatedAndDisposable: true,
      restoreMustUseCurrentRepositorySchema: true,
      restoreMustRecheckRlsAndAcl: true,
      tokenLossStopsFutureClaims: true,
      tokenRecoveryRequiresExplicitReauthentication: true,
      productionRestoreAllowedByThisPack: false,
      productionPayloadsMayBeLogged: false,
    });
  });
});

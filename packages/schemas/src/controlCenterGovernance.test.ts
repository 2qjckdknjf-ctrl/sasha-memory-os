import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK,
  routingCorrectionRequestSchema,
} from './controlCenterGovernance.js';

describe('M19 Control Center governance pack', () => {
  it('freezes every mandatory owner surface and privilege invariant', () => {
    expect(OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK).toMatchObject({
      version: 'm19-s01-v1',
      invariants: {
        ownerOnlyMutations: true,
        explicitWorkspaceRequired: true,
        noDemoActorSwitchingOnOwnerSurface: true,
        rawSecretsNeverReturned: true,
        rawPrivatePayloadsNeverReturned: true,
        replayDeadLetterOnly: true,
        routingCorrectionAudited: true,
        boundedLists: true,
      },
      limits: { defaultList: 50, maxList: 200, freshnessSlaSeconds: 86_400 },
    });
    expect(OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK.mandatorySurfaces).toHaveLength(10);
  });

  it('requires an explicit target project and bounded owner reason', () => {
    expect(
      routingCorrectionRequestSchema.parse({
        corrected_project_id: '44444444-4444-4444-8444-444444444402',
        classification: 'MOVE_TO_MEMORY_OS',
        reason: 'Owner confirmed canonical project.',
      }),
    ).toMatchObject({
      corrected_project_id: '44444444-4444-4444-8444-444444444402',
      classification: 'MOVE_TO_MEMORY_OS',
    });
    expect(
      routingCorrectionRequestSchema.safeParse({
        classification: 'MOVE_TO_MEMORY_OS',
        reason: 'ok',
      }).success,
    ).toBe(false);
  });
});

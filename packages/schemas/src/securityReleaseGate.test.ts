import { describe, expect, it } from 'vitest';
import { OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK } from './securityReleaseGate.js';

describe('M20 security release gate pack', () => {
  it('freezes the complete release boundary and zero-P0/P1 rule', () => {
    expect(OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK).toMatchObject({
      version: 'm20-s01-v1',
      invariants: {
        allPublicMemoryTablesUseRls: true,
        allPrivilegedRpcsAreSecurityDefiner: true,
        allSecurityDefinersPinSearchPath: true,
        clientRolesCannotExecutePrivilegedRpcs: true,
        clientRolesCannotUsePrivateSchema: true,
        serviceRoleRequiredForPrivilegedRpcs: true,
        opaqueSecretsStayServerSide: true,
        revokeStopsFutureSync: true,
        explicitWorkspaceAndProjectScope: true,
        untrustedSourceContentNeverBecomesInstructions: true,
        browserBundlesContainNoServerSecrets: true,
        noOpenP0OrP1: true,
      },
    });
    expect(OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK.requiredGates).toHaveLength(7);
    expect(OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK.threatSurfaces).toHaveLength(8);
  });
});

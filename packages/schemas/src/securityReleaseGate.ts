export const OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK_VERSION =
  'm20-s01-v1' as const;

export const OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK = {
  version: OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK_VERSION,
  goal: 'zero open P0/P1 security or privacy findings before GA',
  requiredGates: [
    'exhaustive-rls-acl-boundary',
    'oauth-vault-revoke-boundary',
    'repository-security-scanners',
    'dependency-audit',
    'refreshed-threat-model',
    'production-auth-leaked-password-protection',
    'zero-open-p0-p1',
  ],
  threatSurfaces: [
    'database-rls-rpcs',
    'oauth-webhooks-vault',
    'connectors-and-replay',
    'apple-companion',
    'entity-graph-retrieval',
    'agent-writeback-and-promotion',
    'browser-control-center',
    'backup-export-and-logs',
  ],
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
} as const;

export type M20SecurityReleaseGatePack =
  typeof OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK;

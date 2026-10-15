export const OFFICIAL_M20_PRIVACY_COMPLIANCE_GATE_PACK_VERSION =
  'm20-s04-v1' as const;

export const OFFICIAL_M20_PRIVACY_COMPLIANCE_GATE_PACK = {
  version: OFFICIAL_M20_PRIVACY_COMPLIANCE_GATE_PACK_VERSION,
  roadmapSections: ['20.4', 'privacy-compliance-operations'],
  surfaces: {
    export: 'GET /v1/export/privacy',
    createRequest: 'POST /v1/privacy/requests',
    executeRequest: 'POST /v1/privacy/requests/:id/execute',
    retention: 'POST /v1/privacy/retention/run',
  },
  retentionDays: {
    candidateMemories: 90,
    quarantineArtifacts: 180,
    publishedOutbox: 30,
    deadLetters: 90,
    audit: 365,
  },
  invariants: {
    ownerOnly: true,
    explicitProjectRequired: true,
    derivedMemoriesIncluded: true,
    sourceRevocationDeletesVaultReferences: true,
    graphProjectionRemovedOnDeletion: true,
    exportIncludesProvenanceAndEvidence: true,
    dryRunRetentionByDefault: true,
    auditContainsMetadataOnly: true,
    logsContainSensitiveBodies: false,
    modeAToolCount: 7,
  },
} as const;

const ALLOWED_OPERATIONAL_FIELDS = new Set([
  'requestId',
  'requestType',
  'status',
  'workspaceId',
  'projectId',
  'targetMemoryId',
  'targetConnectorAccountId',
  'operation',
  'affectedMemoryCount',
  'sourceEventCount',
  'artifactCount',
  'graphProjectionCount',
  'vaultReferenceCount',
  'stoppedJobCount',
  'sourceRevoked',
  'policyVersion',
  'dryRun',
  'candidateMemories',
  'quarantineArtifacts',
  'publishedOutboxEvents',
  'deadLetterJobs',
  'auditEvents',
]);

/**
 * Privacy telemetry is deliberately allowlisted. Unknown values—including
 * content, payload, reason, correction text and credentials—are discarded.
 */
export function sanitizePrivacyOperationalFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => {
      if (!ALLOWED_OPERATIONAL_FIELDS.has(key)) return false;
      return (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      );
    }),
  );
}

import { z } from 'zod';

export const OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK_VERSION =
  'm19-s01-v1' as const;

export const OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK = {
  version: OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK_VERSION,
  goal: 'owner can understand and control the memory system without database access',
  mandatorySurfaces: [
    'overview-health-freshness',
    'project-current-state',
    'connector-scope-sync-cursor-errors-revoke-reconnect',
    'unclassified-routing-corrections',
    'review-conflicts-candidate-verification',
    'entity-graph-inspector',
    'jobs-dead-letter-replay',
    'audit-trail',
    'privacy-export-delete-retention-sensitive-sources',
    'search-ranking-evidence',
  ],
  invariants: {
    ownerOnlyMutations: true,
    explicitWorkspaceRequired: true,
    explicitProjectForScopedViews: true,
    noDemoActorSwitchingOnOwnerSurface: true,
    rawSecretsNeverReturned: true,
    rawPrivatePayloadsNeverReturned: true,
    replayDeadLetterOnly: true,
    routingCorrectionAudited: true,
    boundedLists: true,
  },
  limits: {
    defaultList: 50,
    maxList: 200,
    freshnessSlaSeconds: 86_400,
  },
} as const;

export type M19ControlCenterGovernancePack =
  typeof OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK;

export const routingCorrectionRequestSchema = z.object({
  corrected_project_id: z.uuid(),
  classification: z.enum([
    'KEEP_AISTROYKA',
    'MOVE_TO_MEMORY_OS',
    'MOVE_TO_HIAIR',
    'UNCLASSIFIED',
    'REVIEW_REQUIRED',
  ]),
  reason: z.string().trim().min(3).max(1_000),
  source_evidence: z.record(z.string(), z.unknown()).default({}),
});

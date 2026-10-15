import { OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION } from './projectContextPack.js';

export const OFFICIAL_M18_ROMA_INTEGRATION_PACK_VERSION = 'm18-s03-v1' as const;

export const OFFICIAL_M18_ROMA_INTEGRATION_PACK = {
  version: OFFICIAL_M18_ROMA_INTEGRATION_PACK_VERSION,
  consumesProjectContextPack: OFFICIAL_M18_PROJECT_CONTEXT_PACK_VERSION,
  roadmapSections: ['18', 'roma-integration', 'shared-agent-lifecycle'],
  findingPolicy: {
    canonicalStatus: 'candidate',
    requiresReview: true,
    defaultConfidence: 0.6,
  },
  invariants: {
    explicitProjectRequired: true,
    romaSubjectRequired: true,
    subjectScopedContextRequired: true,
    auditedWritesRequired: true,
    deterministicDedupeRequired: true,
    releaseEvidenceRequiredWhenAvailable: true,
    lowConfidenceCannotAutoVerify: true,
    rawMemoryBodiesExcluded: true,
    noDefaultProjectFallback: true,
    modeAToolCount: 7,
  },
} as const;

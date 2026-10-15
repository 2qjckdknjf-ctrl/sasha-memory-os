import { describe, expect, it } from 'vitest';
import { OFFICIAL_M18_ROMA_INTEGRATION_PACK } from './romaIntegrationContract.js';

describe('M18.3 ROMA integration contract', () => {
  it('consumes the M18.2 context pack and keeps findings review-gated', () => {
    expect(OFFICIAL_M18_ROMA_INTEGRATION_PACK).toMatchObject({
      version: 'm18-s03-v1',
      consumesProjectContextPack: 'm18-s02-v1',
      findingPolicy: {
        canonicalStatus: 'candidate',
        requiresReview: true,
        defaultConfidence: 0.6,
      },
      invariants: {
        explicitProjectRequired: true,
        deterministicDedupeRequired: true,
        releaseEvidenceRequiredWhenAvailable: true,
        lowConfidenceCannotAutoVerify: true,
        modeAToolCount: 7,
      },
    });
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_RANKING_WEIGHTS_PACK,
  runBoundedAgenticRetrieval,
  SEARCH_RANKING_VERSION,
} from '@memory-os/retrieval';

type Fixture = {
  version: string;
  rankingVersion: string;
  rankingWeightsVersion: string;
  toolAllowlist: string[];
  cases: Array<{
    id: string;
    maxSteps: number;
    minEvidenceHits: number;
    hitCount: number;
    expectedOutcome: 'answered' | 'not_enough_data' | 'budget_exhausted';
    expectedStopReason: 'enough_evidence' | 'not_enough_data' | 'max_steps';
  }>;
};

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'm20_m13_regression_v1.json'), 'utf8'),
) as Fixture;
const projectId = '44444444-4444-4444-8444-444444444402';

describe('M20.3 frozen M13 regression gate', () => {
  for (const testCase of fixture.cases) {
    it(testCase.id, async () => {
      const result = await runBoundedAgenticRetrieval({
        query: 'M13 regression gate',
        projectId,
        budget: {
          maxSteps: testCase.maxSteps,
          minEvidenceHits: testCase.minEvidenceHits,
        },
        search: async () =>
          Array.from({ length: testCase.hitCount }, (_, index) => ({
            memory: {
              id: `memory-${index + 1}`,
              title: `M13 evidence ${index + 1}`,
              content: `bounded evidence ${index + 1}`,
              status: 'verified',
              projectId,
            },
            score: 1 - index / 10,
          })),
      });

      expect(result.rankingVersion).toBe(fixture.rankingVersion);
      expect(result.rankingWeightsVersion).toBe(fixture.rankingWeightsVersion);
      expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
      expect(result.rankingWeightsVersion).toBe(
        DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.version,
      );
      expect(result.toolAllowlist).toEqual(fixture.toolAllowlist);
      expect(result.writeActionsAttempted).toBe(0);
      expect(result.budget.usedSteps).toBeLessThanOrEqual(testCase.maxSteps);
      expect(result.outcome).toBe(testCase.expectedOutcome);
      expect(result.stopReason).toBe(testCase.expectedStopReason);
    });
  }
});

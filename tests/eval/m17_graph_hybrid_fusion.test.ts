import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fuseGraphHybridHits } from '@memory-os/schemas';

type Fixture = {
  version: string;
  projectId: string;
  thresholds: {
    recallAt3Floor: number;
    mrrMustNotRegress: boolean;
    evidenceRequired: boolean;
  };
  cases: Array<{
    id: string;
    relevantMemoryIds: string[];
    hybridHits: Array<{ memoryId: string; score: number; reason: string }>;
    graphHits: Array<{
      stableId: string;
      memoryId: string;
      graphScore: number;
      evidenceRefs: string[];
    }>;
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../apps/api/fixtures/entity-graph/m17-s06-v1/golden-graph-hybrid-fusion-cases.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as Fixture;

function recallAt(ids: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 1;
  const found = ids.slice(0, k).filter((id) => relevant.has(id)).length;
  return found / relevant.size;
}

function reciprocalRank(ids: string[], relevant: Set<string>): number {
  const index = ids.findIndex((id) => relevant.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

describe('M17.6 frozen graph/hybrid retrieval evaluation', () => {
  it('improves aggregate MRR without regressing Recall@3 or admitting unsupported graph assertions', () => {
    expect(fixture.version).toBe('m17-s06-v1');
    let baselineMrr = 0;
    let fusedMrr = 0;

    for (const testCase of fixture.cases) {
      const relevant = new Set(testCase.relevantMemoryIds);
      const baselineIds = [...testCase.hybridHits]
        .sort((left, right) => right.score - left.score)
        .map((hit) => hit.memoryId);
      const fused = fuseGraphHybridHits({
        projectId: fixture.projectId,
        hybridHits: testCase.hybridHits,
        graphHits: testCase.graphHits,
      });
      const fusedIds = fused.map((hit) => hit.memoryId);

      expect(
        recallAt(fusedIds, relevant, 3),
        `${testCase.id}: Recall@3`,
      ).toBeGreaterThanOrEqual(fixture.thresholds.recallAt3Floor);
      expect(
        recallAt(fusedIds, relevant, 3),
        `${testCase.id}: no Recall@3 regression`,
      ).toBeGreaterThanOrEqual(recallAt(baselineIds, relevant, 3));
      expect(
        fused.every(
          (hit) => hit.graphScore === 0 || hit.evidenceRefs.length > 0,
        ),
        `${testCase.id}: evidence-bearing graph score`,
      ).toBe(fixture.thresholds.evidenceRequired);
      expect(fusedIds).not.toContain('unsupported-graph-only');

      baselineMrr += reciprocalRank(baselineIds, relevant);
      fusedMrr += reciprocalRank(fusedIds, relevant);
    }

    baselineMrr /= fixture.cases.length;
    fusedMrr /= fixture.cases.length;
    expect(fusedMrr).toBeGreaterThanOrEqual(baselineMrr);
    expect(fusedMrr).toBeGreaterThan(baselineMrr);
  });
});

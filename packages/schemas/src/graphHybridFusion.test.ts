import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK,
  OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK_VERSION,
} from './graphHybridFusion.js';

describe('M17.6 graph/hybrid fusion pack', () => {
  it('freezes explicit, bounded and evidence-bearing graph ranking', () => {
    expect(OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK_VERSION).toBe('m17-s06-v1');
    expect(OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK.invariants).toMatchObject({
      explicitGraphModeRequired: true,
      explicitProjectRequired: true,
      durableBackendRequired: true,
      graphAssertionsRequireEvidence: true,
      hybridModeRankingUnchanged: true,
      modeAToolCount: 7,
    });
    expect(OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK.budgets).toEqual({
      maxSeeds: 8,
      maxHops: 2,
      maxNodes: 24,
      maxEdges: 48,
      minConfidence: 0.7,
    });
  });
});

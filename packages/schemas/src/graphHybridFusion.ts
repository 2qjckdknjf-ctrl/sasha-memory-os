import {
  GRAPH_EDGE_EVIDENCE_THRESHOLD,
  GRAPH_HYBRID_FUSION_WEIGHT,
  GRAPH_TRAVERSAL_MAX_EDGES,
  GRAPH_TRAVERSAL_MAX_HOPS,
  GRAPH_TRAVERSAL_MAX_NODES,
} from './graphRetrieval.js';

export const OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK_VERSION =
  'm17-s06-v1' as const;

export const OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK = {
  version: OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK_VERSION,
  roadmapSections: ['17', 'graph-aware-retrieval', 'retrieval-evals'],
  ranking: {
    name: 'hybrid-rrf+graph-evidence',
    graphWeight: GRAPH_HYBRID_FUSION_WEIGHT,
    scoreNormalization: 'divide_by_max_hybrid_score',
  },
  budgets: {
    maxSeeds: 8,
    maxHops: GRAPH_TRAVERSAL_MAX_HOPS,
    maxNodes: GRAPH_TRAVERSAL_MAX_NODES,
    maxEdges: GRAPH_TRAVERSAL_MAX_EDGES,
    minConfidence: GRAPH_EDGE_EVIDENCE_THRESHOLD,
  },
  invariants: {
    explicitGraphModeRequired: true,
    explicitProjectRequired: true,
    durableBackendRequired: true,
    graphAssertionsRequireEvidence: true,
    aclFilteredGraphRpcRequired: true,
    hybridModeRankingUnchanged: true,
    noDefaultProjectFallback: true,
    modeAToolCount: 7,
  },
  evals: {
    relevantTopKMustNotRegress: true,
    evidenceLessGraphHitsMustNotRank: true,
    noCrossProjectGraphHits: true,
    frozenFixtureVersion: 'm17-s06-v1',
  },
} as const;

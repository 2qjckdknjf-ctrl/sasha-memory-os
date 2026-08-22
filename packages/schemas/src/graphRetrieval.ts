import type { EntityEdgeType } from './entityGraph.js';

export const OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION = 'm17-s03-v1' as const;

export const GRAPH_TRAVERSAL_MAX_HOPS = 2 as const;
export const GRAPH_TRAVERSAL_MAX_NODES = 24 as const;
export const GRAPH_TRAVERSAL_MAX_EDGES = 48 as const;
export const GRAPH_EDGE_EVIDENCE_THRESHOLD = 0.7 as const;
export const GRAPH_HYBRID_FUSION_WEIGHT = 0.45 as const;

export type GraphTraversalEdge = {
  fromStableId: string;
  toStableId: string;
  edgeType: EntityEdgeType;
  evidenceConfidence: number;
  sourceRef: string;
};

export type GraphTraversalStopReason =
  | 'complete'
  | 'max_hops'
  | 'max_nodes'
  | 'max_edges'
  | 'low_evidence';

export type GraphTraversalResult = {
  seedStableId: string;
  visitedNodes: string[];
  traversedEdges: GraphTraversalEdge[];
  stoppedReason: GraphTraversalStopReason;
};

export type HybridRetrievalHit = {
  stableId?: string | null;
  memoryId: string;
  score: number;
  reason: string;
};

export type FusedRetrievalHit = {
  stableId?: string | null;
  memoryId: string;
  graphScore: number;
  hybridScore: number;
  fusedScore: number;
  evidenceRefs: string[];
  reason: string;
};

export type GraphRetrievalPlan = {
  enabled: boolean;
  reason: string;
  budget: {
    maxHops: number;
    maxNodes: number;
    maxEdges: number;
    minEdgeEvidenceConfidence: number;
    graphWeight: number;
  };
};

export const OFFICIAL_M17_GRAPH_RETRIEVAL_PACK = {
  version: OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION,
  roadmapSections: ['17.3', 'graph-aware-retrieval'],
  defaults: {
    maxHops: GRAPH_TRAVERSAL_MAX_HOPS,
    maxNodes: GRAPH_TRAVERSAL_MAX_NODES,
    maxEdges: GRAPH_TRAVERSAL_MAX_EDGES,
    minEdgeEvidenceConfidence: GRAPH_EDGE_EVIDENCE_THRESHOLD,
    graphWeight: GRAPH_HYBRID_FUSION_WEIGHT,
  },
  acceptance: {
    boundedTraversalRequired: true,
    evidenceThresholdRequired: true,
    hybridFusionRequired: true,
  },
  invariants: {
    combinesWithHybridAgenticRetrieval: true,
    neverUnboundedTraversal: true,
    graphAssertionsRequireEvidence: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveGraphRetrievalE2EPassFromMocks: false,
  },
  liveGraphRetrievalE2E: {
    statusInThisSlice: 'contract_pass_live_graph_retrieval_blocked',
    note: 'Graph traversal + hybrid fusion contracts PASS; live graph DB traversal E2E blocked.',
  },
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

function edgeKey(edge: GraphTraversalEdge): string {
  return `${edge.fromStableId}->${edge.toStableId}:${edge.edgeType}:${edge.sourceRef}`;
}

/**
 * Bounded BFS over entity graph edges. Edges below evidence threshold are ignored.
 */
export function traverseGraphBounded(input: {
  projectId: string;
  seedStableId: string;
  edges: GraphTraversalEdge[];
  maxHops?: number;
  maxNodes?: number;
  maxEdges?: number;
  minEdgeEvidenceConfidence?: number;
}): GraphTraversalResult {
  requireExplicitProjectId(input.projectId);

  const maxHops = input.maxHops ?? GRAPH_TRAVERSAL_MAX_HOPS;
  const maxNodes = input.maxNodes ?? GRAPH_TRAVERSAL_MAX_NODES;
  const maxEdges = input.maxEdges ?? GRAPH_TRAVERSAL_MAX_EDGES;
  const minConfidence =
    input.minEdgeEvidenceConfidence ?? GRAPH_EDGE_EVIDENCE_THRESHOLD;

  const seed = input.seedStableId.trim();
  if (!seed) {
    throw new Error('seedStableId is required');
  }

  const eligible = input.edges.filter(
    (edge) => edge.evidenceConfidence >= minConfidence,
  );

  const adjacency = new Map<string, GraphTraversalEdge[]>();
  for (const edge of eligible) {
    const fromList = adjacency.get(edge.fromStableId) ?? [];
    fromList.push(edge);
    adjacency.set(edge.fromStableId, fromList);

    const toList = adjacency.get(edge.toStableId) ?? [];
    toList.push(edge);
    adjacency.set(edge.toStableId, toList);
  }

  const visited = new Set<string>([seed]);
  const traversed: GraphTraversalEdge[] = [];
  const traversedKeys = new Set<string>();
  let frontier = [seed];
  let hops = 0;
  let stoppedReason: GraphTraversalStopReason = 'complete';

  while (frontier.length > 0 && hops < maxHops) {
    const nextFrontier: string[] = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        if (traversed.length >= maxEdges) {
          stoppedReason = 'max_edges';
          frontier = [];
          break;
        }

        const key = edgeKey(edge);
        if (traversedKeys.has(key)) continue;

        const neighbor =
          edge.fromStableId === node ? edge.toStableId : edge.fromStableId;

        traversedKeys.add(key);
        traversed.push(edge);

        if (!visited.has(neighbor)) {
          if (visited.size >= maxNodes) {
            stoppedReason = 'max_nodes';
            frontier = [];
            break;
          }
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }

    if (stoppedReason === 'max_nodes' || stoppedReason === 'max_edges') {
      break;
    }

    frontier = nextFrontier;
    hops += 1;
    if (hops >= maxHops && nextFrontier.length > 0) {
      stoppedReason = 'max_hops';
    }
  }

  if (eligible.length === 0 && input.edges.length > 0) {
    stoppedReason = 'low_evidence';
  }

  return {
    seedStableId: seed,
    visitedNodes: [...visited],
    traversedEdges: traversed,
    stoppedReason,
  };
}

export function planGraphRetrieval(input: {
  projectId: string;
  query: string;
  seeds: Array<{ stableId: string; hybridScore?: number }>;
  hybridHitCount: number;
}): GraphRetrievalPlan {
  requireExplicitProjectId(input.projectId);
  const budget = {
    maxHops: GRAPH_TRAVERSAL_MAX_HOPS,
    maxNodes: GRAPH_TRAVERSAL_MAX_NODES,
    maxEdges: GRAPH_TRAVERSAL_MAX_EDGES,
    minEdgeEvidenceConfidence: GRAPH_EDGE_EVIDENCE_THRESHOLD,
    graphWeight: GRAPH_HYBRID_FUSION_WEIGHT,
  };

  const usableSeeds = input.seeds.filter((seed) => seed.stableId.trim().length > 0);
  if (!input.query.trim()) {
    return {
      enabled: false,
      reason: 'empty query; graph retrieval disabled',
      budget,
    };
  }

  if (usableSeeds.length === 0) {
    return {
      enabled: false,
      reason: 'no graph seeds; hybrid-only retrieval',
      budget,
    };
  }

  if (input.hybridHitCount <= 0) {
    return {
      enabled: false,
      reason: 'no hybrid hits to ground graph traversal',
      budget,
    };
  }

  return {
    enabled: true,
    reason: 'hybrid hits provide seeds for bounded graph traversal',
    budget,
  };
}

export function fuseGraphHybridHits(input: {
  projectId: string;
  graphHits: Array<{
    stableId: string;
    memoryId: string;
    graphScore: number;
    evidenceRefs: string[];
  }>;
  hybridHits: HybridRetrievalHit[];
  graphWeight?: number;
}): FusedRetrievalHit[] {
  requireExplicitProjectId(input.projectId);
  const graphWeight = input.graphWeight ?? GRAPH_HYBRID_FUSION_WEIGHT;
  const hybridWeight = 1 - graphWeight;

  const byMemory = new Map<string, FusedRetrievalHit>();

  for (const hit of input.hybridHits) {
    byMemory.set(hit.memoryId, {
      stableId: hit.stableId ?? null,
      memoryId: hit.memoryId,
      graphScore: 0,
      hybridScore: hit.score,
      fusedScore: hit.score * hybridWeight,
      evidenceRefs: [],
      reason: hit.reason,
    });
  }

  for (const graphHit of input.graphHits) {
    const existing = byMemory.get(graphHit.memoryId);
    if (existing) {
      existing.stableId = existing.stableId ?? graphHit.stableId;
      existing.graphScore = Math.max(existing.graphScore, graphHit.graphScore);
      existing.fusedScore =
        existing.hybridScore * hybridWeight +
        existing.graphScore * graphWeight;
      existing.evidenceRefs = [
        ...new Set([...existing.evidenceRefs, ...graphHit.evidenceRefs]),
      ];
      existing.reason = `graph+hybrid fusion (${existing.reason})`;
      continue;
    }

    byMemory.set(graphHit.memoryId, {
      stableId: graphHit.stableId,
      memoryId: graphHit.memoryId,
      graphScore: graphHit.graphScore,
      hybridScore: 0,
      fusedScore: graphHit.graphScore * graphWeight,
      evidenceRefs: [...graphHit.evidenceRefs],
      reason: 'graph-only hit',
    });
  }

  return [...byMemory.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

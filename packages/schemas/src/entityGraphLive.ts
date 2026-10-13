import { z } from 'zod';

export const OFFICIAL_M17_LIVE_GRAPH_PACK_VERSION = 'm17-s05-v1' as const;
export const LIVE_GRAPH_MAX_HOPS = 2 as const;
export const LIVE_GRAPH_MAX_NODES = 24 as const;
export const LIVE_GRAPH_MAX_EDGES = 48 as const;
export const LIVE_GRAPH_MIN_CONFIDENCE = 0.7 as const;

export const graphRetrieveRequestSchema = z.object({
  project_id: z.string().uuid(),
  seed_entity_ids: z.array(z.string().uuid()).min(1).max(8),
  max_hops: z.number().int().min(1).max(LIVE_GRAPH_MAX_HOPS).optional(),
  max_nodes: z.number().int().min(1).max(LIVE_GRAPH_MAX_NODES).optional(),
  max_edges: z.number().int().min(1).max(LIVE_GRAPH_MAX_EDGES).optional(),
  min_confidence: z.number().min(LIVE_GRAPH_MIN_CONFIDENCE).max(1).optional(),
});

export const OFFICIAL_M17_LIVE_GRAPH_PACK = {
  version: OFFICIAL_M17_LIVE_GRAPH_PACK_VERSION,
  roadmapSections: ['17.3', '17.4', 'graph-aware-retrieval', 'entity-inspector'],
  budgets: {
    maxHops: LIVE_GRAPH_MAX_HOPS,
    maxNodes: LIVE_GRAPH_MAX_NODES,
    maxEdges: LIVE_GRAPH_MAX_EDGES,
    minConfidence: LIVE_GRAPH_MIN_CONFIDENCE,
    maxSeeds: 8,
  },
  invariants: {
    explicitProjectRequired: true,
    subjectAclRequired: true,
    evidenceRequired: true,
    directBrowserTableAccessAllowed: false,
    crossProjectTraversalAllowed: false,
    useDefaultProjectFallback: false,
    modeAToolCount: 7,
    claimLivePassFromMocks: false,
  },
  acceptance: {
    entitySearch: 'live_database_required',
    entityInspector: 'live_database_required',
    boundedTraversal: 'live_database_required',
    readAfterWrite: 'live_database_required',
  },
} as const;

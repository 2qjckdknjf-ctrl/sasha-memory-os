import { describe, expect, it } from 'vitest';
import {
  GRAPH_EDGE_EVIDENCE_THRESHOLD,
  OFFICIAL_M17_GRAPH_RETRIEVAL_PACK,
  OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION,
  fuseGraphHybridHits,
  planGraphRetrieval,
  traverseGraphBounded,
} from './graphRetrieval.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M17.3 graph-aware retrieval pack', () => {
  it('publishes bounded traversal without live graph retrieval E2E PASS', () => {
    expect(OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION).toBe('m17-s03-v1');
    expect(OFFICIAL_M17_GRAPH_RETRIEVAL_PACK.invariants).toMatchObject({
      neverUnboundedTraversal: true,
      claimLiveGraphRetrievalE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(GRAPH_EDGE_EVIDENCE_THRESHOLD).toBe(0.7);
  });

  it('traverses within bounds and fuses graph with hybrid hits', () => {
    const traversal = traverseGraphBounded({
      projectId,
      seedStableId: 'entity:project:memory_os:4444',
      edges: [
        {
          fromStableId: 'entity:project:memory_os:4444',
          toStableId: 'entity:repository:github:org/repo',
          edgeType: 'owns',
          evidenceConfidence: 0.95,
          sourceRef: 'github:webhook',
        },
        {
          fromStableId: 'entity:repository:github:org/repo',
          toStableId: 'entity:decision:memory_os:m17-1',
          edgeType: 'decided_in',
          evidenceConfidence: 0.4,
          sourceRef: 'weak',
        },
      ],
      maxHops: 2,
      maxNodes: 10,
      maxEdges: 10,
    });

    expect(traversal.visitedNodes).toContain('entity:repository:github:org/repo');
    expect(traversal.visitedNodes).not.toContain('entity:decision:memory_os:m17-1');
    expect(traversal.traversedEdges).toHaveLength(1);

    expect(
      planGraphRetrieval({
        projectId,
        query: 'milestone status',
        seeds: [{ stableId: 'entity:project:memory_os:4444', hybridScore: 0.9 }],
        hybridHitCount: 3,
      }).enabled,
    ).toBe(true);

    expect(
      planGraphRetrieval({
        projectId,
        query: 'milestone status',
        seeds: [],
        hybridHitCount: 3,
      }).enabled,
    ).toBe(false);

    const fused = fuseGraphHybridHits({
      projectId,
      graphHits: [
        {
          stableId: 'entity:decision:memory_os:m17-2',
          memoryId: 'mem-graph',
          graphScore: 0.8,
          evidenceRefs: ['edge:works_on'],
        },
      ],
      hybridHits: [
        {
          stableId: 'entity:decision:memory_os:m17-2',
          memoryId: 'mem-graph',
          score: 0.9,
          reason: 'hybrid rrf',
        },
      ],
    });

    expect(fused[0]?.fusedScore).toBeGreaterThan(0.8);
    expect(fused[0]?.evidenceRefs).toContain('edge:works_on');
  });

  it('stops the current hop layer as soon as max nodes is reached', () => {
    const traversal = traverseGraphBounded({
      projectId,
      seedStableId: 'entity:project:memory_os:4444',
      edges: [
        {
          fromStableId: 'entity:project:memory_os:4444',
          toStableId: 'entity:repository:github:org/a',
          edgeType: 'owns',
          evidenceConfidence: 0.95,
          sourceRef: 'seed-a',
        },
        {
          fromStableId: 'entity:project:memory_os:4444',
          toStableId: 'entity:repository:github:org/b',
          edgeType: 'owns',
          evidenceConfidence: 0.95,
          sourceRef: 'seed-b',
        },
        {
          fromStableId: 'entity:project:memory_os:4444',
          toStableId: 'entity:repository:github:org/c',
          edgeType: 'owns',
          evidenceConfidence: 0.95,
          sourceRef: 'seed-c',
        },
        {
          fromStableId: 'entity:repository:github:org/a',
          toStableId: 'entity:decision:memory_os:m17-2',
          edgeType: 'decided_in',
          evidenceConfidence: 0.95,
          sourceRef: 'hop-a',
        },
        {
          fromStableId: 'entity:repository:github:org/b',
          toStableId: 'entity:decision:memory_os:m17-3',
          edgeType: 'decided_in',
          evidenceConfidence: 0.95,
          sourceRef: 'hop-b',
        },
        {
          fromStableId: 'entity:repository:github:org/c',
          toStableId: 'entity:decision:memory_os:m17-4',
          edgeType: 'decided_in',
          evidenceConfidence: 0.95,
          sourceRef: 'hop-c',
        },
      ],
      maxHops: 2,
      maxNodes: 5,
      maxEdges: 10,
    });

    expect(traversal.stoppedReason).toBe('max_nodes');
    expect(traversal.visitedNodes).toHaveLength(5);
    expect(traversal.traversedEdges.map((edge) => edge.sourceRef)).toEqual([
      'seed-a',
      'seed-b',
      'seed-c',
      'hop-a',
    ]);
  });
});

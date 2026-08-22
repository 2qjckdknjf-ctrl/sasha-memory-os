import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M17_GRAPH_RETRIEVAL_PACK,
  traverseGraphBounded,
  type GraphTraversalEdge,
  type GraphTraversalStopReason,
} from '@memory-os/schemas';

const fixturePath = resolve(
  import.meta.dirname,
  '../fixtures/entity-graph/m17-s03-v1/golden-graph-traversal-cases.json',
);

const projectId = '44444444-4444-4444-8444-444444444401';

type GoldenCase = {
  id: string;
  seedStableId: string;
  edges: GraphTraversalEdge[];
  maxHops?: number;
  maxNodes?: number;
  maxEdges?: number;
  expectedVisited?: string[];
  expectedVisitedCount?: number;
  expectedEdgeCount: number;
  expectedStopReason: GraphTraversalStopReason;
};

describe('M17.3 golden graph traversal set', () => {
  it('meets bounded traversal expectations on the approved fixture', () => {
    const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(5);

    let correct = 0;
    for (const item of cases) {
      const result = traverseGraphBounded({
        projectId,
        seedStableId: item.seedStableId,
        edges: item.edges,
        maxHops: item.maxHops,
        maxNodes: item.maxNodes,
        maxEdges: item.maxEdges,
      });

      const visitedOk = item.expectedVisited
        ? item.expectedVisited.every((id) => result.visitedNodes.includes(id)) &&
          result.visitedNodes.length === item.expectedVisited.length
        : item.expectedVisitedCount
          ? result.visitedNodes.length === item.expectedVisitedCount
          : true;

      const ok =
        visitedOk &&
        result.traversedEdges.length === item.expectedEdgeCount &&
        result.stoppedReason === item.expectedStopReason;

      if (ok) correct += 1;
      else {
        expect.soft({ id: item.id, result }, `case ${item.id}`).toMatchObject({
          result: {
            stoppedReason: item.expectedStopReason,
          },
        });
      }
    }

    const precision = correct / cases.length;
    expect(precision).toBeGreaterThanOrEqual(1);
    expect(OFFICIAL_M17_GRAPH_RETRIEVAL_PACK.acceptance.boundedTraversalRequired).toBe(
      true,
    );
  });
});

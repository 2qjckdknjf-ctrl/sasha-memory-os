import { describe, expect, it } from "vitest";
import {
  EDGE_GRAPH_FUSION_PACK_VERSION,
  fuseEdgeGraphHits,
} from "../../../supabase/functions/memory-mcp/graphFusion.ts";

const projectId = "44444444-4444-4444-8444-444444444402";

describe("Edge M17.6 graph/hybrid fusion", () => {
  it("promotes an evidence-backed relevant hit and rejects unsupported graph-only hits", () => {
    const fused = fuseEdgeGraphHits({
      projectId,
      hybridHits: [
        {
          memory: { id: "distractor", title: "Lexical distractor" },
          score: 0.04,
          reason: "hybrid:rpc+rrf",
        },
        {
          memory: { id: "relevant", title: "Evidence-backed decision" },
          score: 0.038,
          reason: "hybrid:rpc+rrf",
        },
      ],
      graphNodes: [{ id: "entity-1", stableId: "entity:decision:relevant" }],
      graphMemories: [
        {
          id: "relevant",
          graphScore: 1,
          entityIds: ["entity-1"],
          evidenceRefs: ["memory-entity:relevant"],
          recordedAt: "2026-08-02T00:00:00.000Z",
        },
        {
          id: "unsupported",
          graphScore: 1,
          entityIds: ["entity-1"],
          evidenceRefs: [],
          recordedAt: "2026-08-03T00:00:00.000Z",
        },
        {
          id: "old-evidence",
          graphScore: 1,
          entityIds: ["entity-1"],
          evidenceRefs: ["memory-entity:old"],
          recordedAt: "2025-08-03T00:00:00.000Z",
        },
      ],
      recordedAfter: "2026-01-01T00:00:00.000Z",
    });

    expect(EDGE_GRAPH_FUSION_PACK_VERSION).toBe("m17-s06-v1");
    expect(fused[0]).toMatchObject({
      memory: { id: "relevant" },
      graphScore: 1,
      hybridScore: 0.95,
      evidenceRefs: ["memory-entity:relevant"],
    });
    expect(fused.some((hit) => hit.memory.id === "unsupported")).toBe(false);
    expect(fused.some((hit) => hit.memory.id === "old-evidence")).toBe(false);
  });

  it("fails closed when a hybrid RPC row belongs to another project", () => {
    expect(() =>
      fuseEdgeGraphHits({
        projectId,
        hybridHits: [
          {
            memory: { id: "foreign", projectId: "project-other" },
            score: 1,
            reason: "hybrid:rpc+rrf",
          },
        ],
        graphNodes: [],
        graphMemories: [],
      })
    ).toThrow(/hybrid search project mismatch/i);
  });
});

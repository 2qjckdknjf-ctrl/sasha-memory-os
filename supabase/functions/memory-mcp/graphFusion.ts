export const EDGE_GRAPH_FUSION_PACK_VERSION = "m17-s06-v1" as const;
export const EDGE_GRAPH_WEIGHT = 0.45;

export type EdgeSearchHit = {
  memory: Record<string, unknown>;
  score: number;
  reason: string;
  personalization?: Record<string, unknown> | null;
};

export type EdgeGraphSearchHit = EdgeSearchHit & {
  graphScore: number;
  hybridScore: number;
  fusedScore: number;
  evidenceRefs: string[];
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unitScore(value: unknown): number {
  const score = Number(value ?? 0);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return Math.min(1, score);
}

function sameProjectId(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function inRecordedWindow(
  recordedAt: unknown,
  recordedAfter?: string | null,
  recordedBefore?: string | null,
): boolean {
  if (!recordedAfter && !recordedBefore) return true;
  if (typeof recordedAt !== "string") return false;
  const recorded = Date.parse(recordedAt);
  if (Number.isNaN(recorded)) return false;
  if (recordedAfter) {
    const after = Date.parse(recordedAfter);
    if (!Number.isNaN(after) && recorded < after) return false;
  }
  if (recordedBefore) {
    const before = Date.parse(recordedBefore);
    if (!Number.isNaN(before) && recorded > before) return false;
  }
  return true;
}

export function fuseEdgeGraphHits(input: {
  projectId: string;
  hybridHits: EdgeSearchHit[];
  graphNodes: unknown[];
  graphMemories: unknown[];
  graphWeight?: number;
  recordedAfter?: string | null;
  recordedBefore?: string | null;
}): EdgeGraphSearchHit[] {
  if (!input.projectId.trim()) throw new Error("project_id is required");
  const graphWeight = input.graphWeight ?? EDGE_GRAPH_WEIGHT;
  if (!Number.isFinite(graphWeight) || graphWeight < 0 || graphWeight > 1) {
    throw new Error("graphWeight must be between 0 and 1");
  }
  const hybridWeight = 1 - graphWeight;
  const maxHybrid = Math.max(
    0,
    ...input.hybridHits.map((hit) =>
      Number.isFinite(hit.score) && hit.score > 0 ? hit.score : 0
    ),
  );
  const stableIdByEntity = new Map<string, string>();
  for (const value of input.graphNodes) {
    const node = recordOf(value);
    if (typeof node.id === "string" && typeof node.stableId === "string") {
      stableIdByEntity.set(node.id, node.stableId);
    }
  }

  const byMemory = new Map<string, EdgeGraphSearchHit>();
  for (const hit of input.hybridHits) {
    const memoryProjectId = String(
      hit.memory.projectId ?? hit.memory.project_id ?? "",
    );
    if (memoryProjectId && !sameProjectId(memoryProjectId, input.projectId)) {
      throw new Error("hybrid search project mismatch");
    }
    const memoryId = typeof hit.memory.id === "string" ? hit.memory.id : "";
    if (!memoryId) continue;
    const hybridScore = maxHybrid > 0 ? unitScore(hit.score / maxHybrid) : 0;
    byMemory.set(memoryId, {
      ...hit,
      score: hybridScore * hybridWeight,
      hybridScore,
      graphScore: 0,
      fusedScore: hybridScore * hybridWeight,
      evidenceRefs: [],
    });
  }

  for (const value of input.graphMemories) {
    const memory = recordOf(value);
    const memoryId = typeof memory.id === "string" ? memory.id : "";
    if (!memoryId) continue;
    if (
      !inRecordedWindow(
        memory.recordedAt,
        input.recordedAfter,
        input.recordedBefore,
      )
    ) continue;
    const evidenceRefs = [
      ...new Set(stringArray(memory.evidenceRefs).map((ref) => ref.trim()).filter(Boolean)),
    ];
    if (evidenceRefs.length === 0) continue;
    const graphScore = unitScore(memory.graphScore);
    const existing = byMemory.get(memoryId);
    if (existing) {
      existing.graphScore = Math.max(existing.graphScore, graphScore);
      existing.fusedScore =
        existing.hybridScore * hybridWeight + existing.graphScore * graphWeight;
      existing.score = existing.fusedScore;
      existing.reason = `graph+hybrid fusion (${existing.reason})`;
      existing.evidenceRefs = [
        ...new Set([...existing.evidenceRefs, ...evidenceRefs]),
      ];
      continue;
    }

    const entityIds = stringArray(memory.entityIds);
    const stableId = entityIds.map((id) => stableIdByEntity.get(id)).find(Boolean) ??
      `memory:${memoryId}`;
    const fusedScore = graphScore * graphWeight;
    byMemory.set(memoryId, {
      memory: {
        id: memoryId,
        title: typeof memory.title === "string" ? memory.title : "untitled",
        content: typeof memory.contentSnippet === "string"
          ? memory.contentSnippet
          : "",
        status: typeof memory.status === "string" ? memory.status : "active",
        memoryType: typeof memory.memoryType === "string"
          ? memory.memoryType
          : null,
        projectId: input.projectId,
        graphStableId: stableId,
      },
      score: fusedScore,
      reason: "graph-only hit",
      graphScore,
      hybridScore: 0,
      fusedScore,
      evidenceRefs,
    });
  }

  return [...byMemory.values()]
    .sort((left, right) =>
      right.fusedScore - left.fusedScore ||
      String(left.memory.id ?? "").localeCompare(String(right.memory.id ?? ""))
    )
    .slice(0, 50);
}

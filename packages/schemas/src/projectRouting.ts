export const OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION = 'm15-s03-v1' as const;

/** Canonical fail-closed inbox target — never a silent default project. */
export const UNCLASSIFIED_PROJECT_ROUTE = 'UNCLASSIFIED' as const;

export const PROJECT_ROUTING_CONFIDENCE_THRESHOLD = 0.8 as const;

export type ProjectRoutingSignalKind =
  | 'explicit_project_id'
  | 'source_mapping'
  | 'collection_binding'
  | 'entity_alias'
  | 'recent_context';

export type ProjectRoutingSignal = {
  kind: ProjectRoutingSignalKind;
  projectId?: string | null;
  weight: number;
  evidence: string;
};

export type ProjectRoutingDecision =
  | {
      outcome: 'routed';
      projectId: string;
      confidence: number;
      explanation: string;
      signals: ProjectRoutingSignal[];
    }
  | {
      outcome: 'unclassified';
      projectId: typeof UNCLASSIFIED_PROJECT_ROUTE;
      confidence: number;
      explanation: string;
      signals: ProjectRoutingSignal[];
      reason:
        | 'low_confidence'
        | 'conflicting_projects'
        | 'missing_signals'
        | 'ambiguous_ref';
    };

export const OFFICIAL_M15_PROJECT_ROUTING_PACK = {
  version: OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION,
  roadmapSections: ['15.3', 'automatic-project-entity-routing'],
  unclassifiedRoute: UNCLASSIFIED_PROJECT_ROUTE,
  confidenceThreshold: PROJECT_ROUTING_CONFIDENCE_THRESHOLD,
  acceptance: {
    goldenPrecisionTarget: 0.95,
    ambiguousMustFailClosed: true,
  },
  invariants: {
    neverUseDefaultProjectFallback: true,
    neverUseAistroykaFallback: true,
    lowConfidenceRoutesToUnclassified: true,
    conflictingSignalsRouteToUnclassified: true,
    writesRequireExplicitProjectIdOrUnclassified: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
  },
} as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Deterministic + signal-weighted project router.
 * Fail closed to UNCLASSIFIED on low confidence or conflicts — never default project.
 */
export function resolveProjectRoute(input: {
  signals: ProjectRoutingSignal[];
  confidenceThreshold?: number;
}): ProjectRoutingDecision {
  const threshold =
    input.confidenceThreshold ?? PROJECT_ROUTING_CONFIDENCE_THRESHOLD;
  const usable = input.signals.filter(
    (signal) =>
      typeof signal.projectId === 'string' &&
      signal.projectId.trim().length > 0 &&
      signal.projectId !== UNCLASSIFIED_PROJECT_ROUTE &&
      signal.weight > 0,
  );

  if (usable.length === 0) {
    return {
      outcome: 'unclassified',
      projectId: UNCLASSIFIED_PROJECT_ROUTE,
      confidence: 0,
      explanation: 'No usable project routing signals; fail closed to UNCLASSIFIED.',
      signals: input.signals,
      reason: 'missing_signals',
    };
  }

  const byProject = new Map<string, { weight: number; evidence: string[] }>();
  for (const signal of usable) {
    const projectId = signal.projectId!.trim();
    const current = byProject.get(projectId) ?? { weight: 0, evidence: [] };
    current.weight += signal.weight;
    current.evidence.push(`${signal.kind}: ${signal.evidence}`);
    byProject.set(projectId, current);
  }

  if (byProject.size > 1) {
    const ranked = [...byProject.entries()].sort((a, b) => b[1].weight - a[1].weight);
    const [topId, top] = ranked[0]!;
    const second = ranked[1]?.[1].weight ?? 0;
    // Clear winner still needs threshold; near-ties fail closed.
    if (top.weight < threshold || top.weight - second < 0.25) {
      return {
        outcome: 'unclassified',
        projectId: UNCLASSIFIED_PROJECT_ROUTE,
        confidence: Math.min(1, top.weight),
        explanation: `Conflicting project signals (top=${topId}); fail closed to UNCLASSIFIED.`,
        signals: input.signals,
        reason: 'conflicting_projects',
      };
    }
  }

  const [[projectId, aggregate]] = [...byProject.entries()].sort(
    (a, b) => b[1].weight - a[1].weight,
  );
  const confidence = Math.min(1, aggregate.weight);
  if (confidence < threshold) {
    return {
      outcome: 'unclassified',
      projectId: UNCLASSIFIED_PROJECT_ROUTE,
      confidence,
      explanation: `Routing confidence ${confidence.toFixed(2)} below threshold ${threshold}; UNCLASSIFIED.`,
      signals: input.signals,
      reason: 'low_confidence',
    };
  }

  if (!isUuid(projectId) && projectId.toLowerCase() === 'aistroyka') {
    return {
      outcome: 'unclassified',
      projectId: UNCLASSIFIED_PROJECT_ROUTE,
      confidence: 0,
      explanation: 'AISTROYKA fallback slug rejected; fail closed to UNCLASSIFIED.',
      signals: input.signals,
      reason: 'ambiguous_ref',
    };
  }

  return {
    outcome: 'routed',
    projectId,
    confidence,
    explanation: `Routed via ${aggregate.evidence.join('; ')}`,
    signals: input.signals,
  };
}

export function buildCollectionBindingSignal(input: {
  collectionId: string;
  projectId: string | null | undefined;
}): ProjectRoutingSignal {
  return {
    kind: 'collection_binding',
    projectId: input.projectId ?? null,
    weight: input.projectId ? 0.9 : 0,
    evidence: input.projectId
      ? `collection ${input.collectionId} bound to ${input.projectId}`
      : `collection ${input.collectionId} has no project binding`,
  };
}

export function buildExplicitProjectSignal(projectId: string): ProjectRoutingSignal {
  return {
    kind: 'explicit_project_id',
    projectId,
    weight: 1,
    evidence: `explicit project_id ${projectId}`,
  };
}

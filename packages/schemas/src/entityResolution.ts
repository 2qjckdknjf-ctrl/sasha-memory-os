import type { EntityClass } from './entityGraph.js';

export const OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION = 'm17-s02-v1' as const;

export const ENTITY_RESOLUTION_CONFIDENCE_THRESHOLD = 0.8 as const;

export type EntityResolutionSource =
  | 'chatgpt'
  | 'github'
  | 'drive'
  | 'gmail'
  | 'calendar'
  | 'apple';

export type EntityResolutionSignalKind =
  | 'stable_source_ref'
  | 'email_address'
  | 'github_login'
  | 'repository_full_name'
  | 'drive_file_id'
  | 'calendar_event_id'
  | 'gmail_thread_id'
  | 'apple_contact_ref'
  | 'alias_exact'
  | 'alias_normalized';

export type EntityResolutionSignal = {
  kind: EntityResolutionSignalKind;
  source: EntityResolutionSource;
  entityClass: EntityClass;
  candidateStableId?: string | null;
  projectId?: string | null;
  alias?: string | null;
  weight: number;
  evidence: string;
};

export type EntityResolutionDecision =
  | {
      outcome: 'resolved';
      stableId: string;
      entityClass: EntityClass;
      confidence: number;
      explanation: string;
      signals: EntityResolutionSignal[];
    }
  | {
      outcome: 'ambiguous';
      confidence: number;
      explanation: string;
      signals: EntityResolutionSignal[];
      reason: 'conflicting_candidates' | 'cross_project_scope';
    }
  | {
      outcome: 'unresolved';
      confidence: number;
      explanation: string;
      signals: EntityResolutionSignal[];
      reason: 'missing_signals' | 'low_confidence' | 'invalid_candidate';
    };

export const OFFICIAL_M17_ENTITY_RESOLUTION_PACK = {
  version: OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION,
  roadmapSections: ['17.2', 'entity-resolution'],
  confidenceThreshold: ENTITY_RESOLUTION_CONFIDENCE_THRESHOLD,
  supportedSources: [
    'chatgpt',
    'github',
    'drive',
    'gmail',
    'calendar',
    'apple',
  ] as const,
  acceptance: {
    goldenPrecisionTarget: 0.95,
    ambiguousMustFailClosed: true,
    noAccidentalCrossProjectPersonMerge: true,
  },
  invariants: {
    crossSourceResolutionSupported: true,
    provenanceRequiredOnSignals: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveEntityResolutionE2EPassFromMocks: false,
  },
  liveEntityResolutionE2E: {
    statusInThisSlice: 'contract_pass_live_resolution_blocked',
    note: 'Golden entity-resolution fixture PASS; live cross-connector resolution E2E blocked.',
  },
} as const;

const SCOPED_ENTITY_CLASSES: EntityClass[] = ['person', 'project', 'goal', 'risk'];

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

function isUsableSignal(signal: EntityResolutionSignal): boolean {
  if (signal.weight <= 0) return false;
  if (signal.kind === 'alias_exact' || signal.kind === 'alias_normalized') {
    return Boolean(signal.candidateStableId?.trim() || signal.alias?.trim());
  }
  return Boolean(signal.candidateStableId?.trim());
}

/**
 * Cross-source entity resolver. Fail closed to ambiguous/unresolved on conflicts
 * or low confidence — never invent a default entity.
 */
export function resolveEntityCandidate(input: {
  projectId: string;
  entityClass: EntityClass;
  signals: EntityResolutionSignal[];
  confidenceThreshold?: number;
}): EntityResolutionDecision {
  const projectId = requireExplicitProjectId(input.projectId);
  const threshold =
    input.confidenceThreshold ?? ENTITY_RESOLUTION_CONFIDENCE_THRESHOLD;
  const scoped = SCOPED_ENTITY_CLASSES.includes(input.entityClass);
  const usable = input.signals.filter(
    (signal) =>
      signal.entityClass === input.entityClass && isUsableSignal(signal),
  );

  if (usable.length === 0) {
    return {
      outcome: 'unresolved',
      confidence: 0,
      explanation: 'No usable entity resolution signals.',
      signals: input.signals,
      reason: 'missing_signals',
    };
  }

  if (scoped) {
    const projectIds = new Set(
      usable
        .map((signal) => signal.projectId?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const hasCurrentProject = projectIds.has(projectId);
    const hasForeignProject = [...projectIds].some((id) => id !== projectId);
    if (hasCurrentProject && hasForeignProject) {
      return {
        outcome: 'ambiguous',
        confidence: 0,
        explanation: 'Conflicting project scope on scoped entity signals.',
        signals: input.signals,
        reason: 'cross_project_scope',
      };
    }
    if (hasForeignProject && !hasCurrentProject) {
      return {
        outcome: 'ambiguous',
        confidence: 0,
        explanation: 'Scoped entity signals belong to a different project.',
        signals: input.signals,
        reason: 'cross_project_scope',
      };
    }
  }

  const byCandidate = new Map<string, { weight: number; evidence: string[] }>();
  for (const signal of usable) {
    const candidate =
      signal.candidateStableId?.trim() ||
      (signal.alias ? `alias:${signal.alias.trim().toLowerCase()}` : '');
    if (!candidate) continue;
    const current = byCandidate.get(candidate) ?? { weight: 0, evidence: [] };
    current.weight += signal.weight;
    current.evidence.push(`${signal.source}/${signal.kind}: ${signal.evidence}`);
    byCandidate.set(candidate, current);
  }

  if (byCandidate.size === 0) {
    return {
      outcome: 'unresolved',
      confidence: 0,
      explanation: 'Signals lacked durable candidate identifiers.',
      signals: input.signals,
      reason: 'invalid_candidate',
    };
  }

  const ranked = [...byCandidate.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const [topId, top] = ranked[0]!;
  const secondWeight = ranked[1]?.[1].weight ?? 0;

  if (top.weight < threshold) {
    return {
      outcome: 'unresolved',
      confidence: Math.min(1, top.weight),
      explanation: `Top candidate below confidence threshold (${top.weight} < ${threshold}).`,
      signals: input.signals,
      reason: 'low_confidence',
    };
  }

  if (ranked.length > 1 && top.weight - secondWeight < 0.2) {
    return {
      outcome: 'ambiguous',
      confidence: Math.min(1, top.weight),
      explanation: 'Near-tie between entity candidates; fail closed to ambiguous.',
      signals: input.signals,
      reason: 'conflicting_candidates',
    };
  }

  if (topId.startsWith('alias:')) {
    return {
      outcome: 'unresolved',
      confidence: Math.min(1, top.weight),
      explanation: 'Top candidate lacks a durable entity stable id.',
      signals: input.signals,
      reason: 'invalid_candidate',
    };
  }

  return {
    outcome: 'resolved',
    stableId: topId,
    entityClass: input.entityClass,
    confidence: Math.min(1, top.weight),
    explanation: `Resolved entity candidate (${top.evidence.join('; ')})`,
    signals: input.signals,
  };
}

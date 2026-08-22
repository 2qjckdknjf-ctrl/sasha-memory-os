export const OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION = 'm17-s01-v1' as const;

export type EntityClass =
  | 'person'
  | 'project'
  | 'company'
  | 'repository'
  | 'document'
  | 'file'
  | 'photo_asset'
  | 'conversation'
  | 'email'
  | 'calendar_event'
  | 'idea'
  | 'decision'
  | 'task'
  | 'goal'
  | 'risk'
  | 'place'
  | 'device'
  | 'source_account';

export type EntityEdgeType =
  | 'owns'
  | 'works_on'
  | 'belongs_to'
  | 'depends_on'
  | 'supersedes'
  | 'decided_in'
  | 'sourced_from'
  | 'blocks'
  | 'relates_to'
  | 'assigned_to'
  | 'scheduled_at'
  | 'stored_in';

export type EntityRef = {
  stableId: string;
  class: EntityClass;
  aliases?: string[];
  projectId?: string | null;
};

export type GraphAssertionEvidence = {
  sourceRef: string;
  memoryId?: string | null;
  observedAt?: string | null;
};

export type EntityMergeDecision = {
  action: 'merge' | 'reject' | 'review';
  reason: string;
};

export type EntitySplitDecision = {
  action: 'split' | 'reject';
  reason: string;
};

export const OFFICIAL_ENTITY_CLASSES: readonly EntityClass[] = [
  'person',
  'project',
  'company',
  'repository',
  'document',
  'file',
  'photo_asset',
  'conversation',
  'email',
  'calendar_event',
  'idea',
  'decision',
  'task',
  'goal',
  'risk',
  'place',
  'device',
  'source_account',
] as const;

export const OFFICIAL_ENTITY_EDGE_TYPES: readonly EntityEdgeType[] = [
  'owns',
  'works_on',
  'belongs_to',
  'depends_on',
  'supersedes',
  'decided_in',
  'sourced_from',
  'blocks',
  'relates_to',
  'assigned_to',
  'scheduled_at',
  'stored_in',
] as const;

export const OFFICIAL_M17_ENTITY_GRAPH_PACK = {
  version: OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION,
  roadmapSections: ['17', 'personal-knowledge-graph'],
  defaults: {
    requireProvenanceOnAssertions: true,
    requireExplicitProjectIdOnWrites: true,
    accidentalCrossProjectMergeBlocked: true,
  },
  invariants: {
    stableEntityIds: true,
    aliasesSupported: true,
    mergeSplitAudited: true,
    temporalEdgesSupported: true,
    graphAssertionsRequireEvidence: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveGraphE2EPassFromMocks: false,
  },
  liveGraphE2E: {
    statusInThisSlice: 'contract_pass_live_graph_blocked',
    note: 'Entity graph foundation contracts PASS; golden resolution live suite and UI inspector blocked until later M17 slices.',
  },
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

export function entityStableId(input: {
  class: EntityClass;
  source: string;
  sourceRef: string;
}): string {
  const source = input.source.trim();
  const sourceRef = input.sourceRef.trim();
  if (!source || !sourceRef) {
    throw new Error('entity stable id requires source and source_ref');
  }
  return `entity:${input.class}:${source}:${sourceRef}`;
}

export function decideEntityMerge(input: {
  projectId: string;
  left: EntityRef;
  right: EntityRef;
  sharedAlias?: string | null;
}): EntityMergeDecision {
  requireExplicitProjectId(input.projectId);

  if (input.left.class !== input.right.class) {
    return {
      action: 'reject',
      reason: 'merge blocked: entity classes differ',
    };
  }

  const scopedClasses: EntityClass[] = ['person', 'project', 'goal', 'risk'];
  if (scopedClasses.includes(input.left.class)) {
    const leftProject = input.left.projectId?.trim() || null;
    const rightProject = input.right.projectId?.trim() || null;
    if (leftProject && rightProject && leftProject !== rightProject) {
      return {
        action: 'reject',
        reason: 'merge blocked: cross-project scoped entities',
      };
    }
  }

  if (input.left.stableId === input.right.stableId) {
    return {
      action: 'merge',
      reason: 'same stable id is idempotent merge',
    };
  }

  const alias = input.sharedAlias?.trim();
  if (alias) {
    const normalized = normalizeAlias(alias);
    const leftAliases = (input.left.aliases ?? []).map(normalizeAlias);
    const rightAliases = (input.right.aliases ?? []).map(normalizeAlias);
    if (leftAliases.includes(normalized) && rightAliases.includes(normalized)) {
      return {
        action: 'merge',
        reason: 'shared normalized alias with matching class and project scope',
      };
    }
  }

  return {
    action: 'review',
    reason: 'insufficient evidence for automatic merge',
  };
}

export function decideEntitySplit(input: {
  projectId: string;
  entity: EntityRef;
  distinctEvidenceGroups: number;
}): EntitySplitDecision {
  requireExplicitProjectId(input.projectId);

  if (input.distinctEvidenceGroups < 2) {
    return {
      action: 'reject',
      reason: 'split requires at least two distinct evidence groups',
    };
  }

  return {
    action: 'split',
    reason: 'distinct evidence groups justify audited split',
  };
}

export function validateGraphAssertion(input: {
  projectId: string;
  edgeType: EntityEdgeType;
  evidence: GraphAssertionEvidence[];
}): { ok: boolean; reason: string } {
  requireExplicitProjectId(input.projectId);

  if (!OFFICIAL_ENTITY_EDGE_TYPES.includes(input.edgeType)) {
    return { ok: false, reason: 'unknown edge type' };
  }

  if (input.evidence.length === 0) {
    return { ok: false, reason: 'graph assertions require provenance evidence' };
  }

  const hasSourceRef = input.evidence.every((item) => item.sourceRef.trim().length > 0);
  if (!hasSourceRef) {
    return { ok: false, reason: 'each evidence item requires source_ref' };
  }

  return { ok: true, reason: 'assertion traceable to evidence' };
}

export function entityGraphIdempotencyKey(input: {
  edgeType: EntityEdgeType;
  fromStableId: string;
  toStableId: string;
  sourceRef: string;
}): string {
  const from = input.fromStableId.trim();
  const to = input.toStableId.trim();
  const sourceRef = input.sourceRef.trim();
  if (!from || !to || !sourceRef) {
    throw new Error('edge idempotency key requires from, to, and source_ref');
  }
  return `edge:${input.edgeType}:${from}->${to}:${sourceRef}`;
}

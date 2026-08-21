export const OFFICIAL_M15_CANONICALIZATION_PACK_VERSION = 'm15-s04-v1' as const;

export type FactClass =
  | 'repository_state'
  | 'calendar_event'
  | 'email_message'
  | 'drive_file'
  | 'user_decision'
  | 'inferred_summary'
  | 'agent_milestone'
  | 'project_blocker';

export type AuthoritySource =
  | 'live_github'
  | 'source_calendar'
  | 'source_gmail'
  | 'source_drive'
  | 'user_approved_decision'
  | 'agent_inferred'
  | 'connector_snapshot';

export const FACT_CLASS_AUTHORITY: Record<
  FactClass,
  { preferred: AuthoritySource[]; outrankedBy: AuthoritySource[] }
> = {
  repository_state: {
    preferred: ['live_github'],
    outrankedBy: [],
  },
  calendar_event: {
    preferred: ['source_calendar'],
    outrankedBy: ['user_approved_decision'],
  },
  email_message: {
    preferred: ['source_gmail'],
    outrankedBy: ['user_approved_decision'],
  },
  drive_file: {
    preferred: ['source_drive'],
    outrankedBy: ['user_approved_decision'],
  },
  user_decision: {
    preferred: ['user_approved_decision'],
    outrankedBy: [],
  },
  inferred_summary: {
    preferred: ['agent_inferred'],
    outrankedBy: [
      'user_approved_decision',
      'live_github',
      'source_calendar',
      'source_gmail',
      'source_drive',
    ],
  },
  agent_milestone: {
    preferred: ['user_approved_decision', 'agent_inferred'],
    outrankedBy: ['user_approved_decision'],
  },
  project_blocker: {
    preferred: ['user_approved_decision', 'agent_inferred'],
    outrankedBy: ['user_approved_decision'],
  },
};

export const OFFICIAL_M15_CANONICALIZATION_PACK = {
  version: OFFICIAL_M15_CANONICALIZATION_PACK_VERSION,
  roadmapSections: ['15.4', 'canonicalization-dedupe-supersession'],
  acceptance: {
    canonicalDuplicateRateMax: 0.01,
    provenanceMustBePreserved: true,
  },
  invariants: {
    sourceLevelDedupeBeforeSemantic: true,
    preserveSupersededByChain: true,
    preserveValidFromValidTo: true,
    preserveProvenanceToSourceEvents: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
  },
} as const;

export type CanonicalCandidate = {
  id: string;
  factClass: FactClass;
  authoritySource: AuthoritySource;
  projectId: string | null;
  sourceEventId?: string | null;
  externalId?: string | null;
  externalVersion?: string | null;
  provider?: string | null;
  contentFingerprint: string;
  validFrom?: string | null;
  validTo?: string | null;
  status?: string | null;
};

export type CanonicalDedupeDecision =
  | {
      action: 'keep_both';
      reason: string;
    }
  | {
      action: 'source_dedupe';
      keeperId: string;
      duplicateId: string;
      reason: string;
    }
  | {
      action: 'supersede';
      keeperId: string;
      duplicateId: string;
      reason: string;
      authority: FactClass;
    };

export function buildSourceDedupeKey(input: {
  provider: string;
  externalId: string;
  externalVersion?: string | null;
}): string {
  const version = input.externalVersion?.trim() || 'v0';
  return `${input.provider.trim().toLowerCase()}::${input.externalId.trim()}@${version}`;
}

export function preferAuthority(
  left: CanonicalCandidate,
  right: CanonicalCandidate,
): 'left' | 'right' | 'tie' {
  if (left.factClass !== right.factClass) return 'tie';
  const matrix = FACT_CLASS_AUTHORITY[left.factClass];
  const leftRank = matrix.preferred.indexOf(left.authoritySource);
  const rightRank = matrix.preferred.indexOf(right.authoritySource);
  const leftPreferred = leftRank >= 0 ? leftRank : 99;
  const rightPreferred = rightRank >= 0 ? rightRank : 99;
  // outrankedBy = sources that beat the weak/default authority for this fact class.
  if (
    matrix.outrankedBy.includes(right.authoritySource) &&
    !matrix.outrankedBy.includes(left.authoritySource)
  ) {
    return 'right';
  }
  if (
    matrix.outrankedBy.includes(left.authoritySource) &&
    !matrix.outrankedBy.includes(right.authoritySource)
  ) {
    return 'left';
  }
  if (leftPreferred < rightPreferred) return 'left';
  if (rightPreferred < leftPreferred) return 'right';
  return 'tie';
}

/**
 * Source-level then authority-aware canonicalization decision.
 * Semantic near-dup consolidation remains in retrieval/consolidation workers;
 * this contract decides keeper vs duplicate without dropping provenance.
 */
export function decideCanonicalDedupe(
  left: CanonicalCandidate,
  right: CanonicalCandidate,
): CanonicalDedupeDecision {
  if (
    left.projectId &&
    right.projectId &&
    left.projectId !== right.projectId
  ) {
    return {
      action: 'keep_both',
      reason: 'cross-project candidates must not merge',
    };
  }

  if (
    left.provider &&
    right.provider &&
    left.externalId &&
    right.externalId &&
    buildSourceDedupeKey({
      provider: left.provider,
      externalId: left.externalId,
      externalVersion: left.externalVersion,
    }) ===
      buildSourceDedupeKey({
        provider: right.provider,
        externalId: right.externalId,
        externalVersion: right.externalVersion,
      })
  ) {
    const winner = preferAuthority(left, right);
    if (winner === 'right') {
      return {
        action: 'source_dedupe',
        keeperId: right.id,
        duplicateId: left.id,
        reason: 'identical source identity; prefer higher authority',
      };
    }
    return {
      action: 'source_dedupe',
      keeperId: left.id,
      duplicateId: right.id,
      reason: 'identical source identity; keep left or equal authority',
    };
  }

  if (
    left.contentFingerprint === right.contentFingerprint &&
    left.factClass === right.factClass
  ) {
    const winner = preferAuthority(left, right);
    if (winner === 'tie') {
      return {
        action: 'supersede',
        keeperId: left.id,
        duplicateId: right.id,
        reason: 'same fingerprint/fact class; stable keep-left supersession',
        authority: left.factClass,
      };
    }
    if (winner === 'right') {
      return {
        action: 'supersede',
        keeperId: right.id,
        duplicateId: left.id,
        reason: 'same fingerprint; authority matrix prefers right',
        authority: left.factClass,
      };
    }
    return {
      action: 'supersede',
      keeperId: left.id,
      duplicateId: right.id,
      reason: 'same fingerprint; authority matrix prefers left',
      authority: left.factClass,
    };
  }

  return {
    action: 'keep_both',
    reason: 'no source identity or fingerprint collision',
  };
}

export function measureCanonicalDuplicateRate(input: {
  totalCanonicalMemories: number;
  duplicatePairsMerged: number;
}): number {
  if (input.totalCanonicalMemories <= 0) return 0;
  return input.duplicatePairsMerged / input.totalCanonicalMemories;
}

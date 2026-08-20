import type { EffectiveMemoryPersonalization, MemoryStatus } from '@memory-os/domain';

export const SEARCH_RANKING_WEIGHTS_VERSION = 'm13-s06-v1';
export const DEFAULT_PINNED_SCORE_MULTIPLIER = 1.75;

export type SearchRankingWeightsPack = Readonly<{
  version: string;
  label: string;
  hardFilters: Readonly<{
    aclVisibility: 'hard-filter';
    projectMatch: 'hard-filter';
    temporalValidity: 'hard-filter';
  }>;
  lexical: Readonly<{
    importanceWeight: number;
    authorityWeight: number;
    conflictPenaltyWeight: number;
    pinnedWeight: number;
    recencyWeight: number;
    recencyHalfLifeDays: number;
  }>;
  hybrid: Readonly<{
    lexicalRankWeight: number;
    vectorRankWeight: number;
    vectorSimilarityTieBreakWeight: number;
  }>;
}>;

type SearchRankingWeightsPackOverride = Partial<{
  version: string;
  label: string;
  hardFilters: Partial<SearchRankingWeightsPack['hardFilters']>;
  lexical: Partial<SearchRankingWeightsPack['lexical']>;
  hybrid: Partial<SearchRankingWeightsPack['hybrid']>;
}>;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function nonNegative(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function blendTowardsNeutral(base: number, weight: number): number {
  return Math.max(0, 1 + (base - 1) * nonNegative(weight, 1));
}

export const DEFAULT_SEARCH_RANKING_WEIGHTS_PACK: SearchRankingWeightsPack =
  Object.freeze({
    version: SEARCH_RANKING_WEIGHTS_VERSION,
    label: 'Official M13 Slice 06 baseline learned-ranking weights',
    hardFilters: Object.freeze({
      aclVisibility: 'hard-filter',
      projectMatch: 'hard-filter',
      temporalValidity: 'hard-filter',
    }),
    lexical: Object.freeze({
      importanceWeight: 1,
      authorityWeight: 1,
      conflictPenaltyWeight: 1,
      pinnedWeight: 1,
      recencyWeight: 0,
      recencyHalfLifeDays: 30,
    }),
    hybrid: Object.freeze({
      lexicalRankWeight: 1,
      vectorRankWeight: 1,
      vectorSimilarityTieBreakWeight: 0.01,
    }),
  });

export function createSearchRankingWeightsPack(
  override?: SearchRankingWeightsPackOverride,
): SearchRankingWeightsPack {
  return Object.freeze({
    version:
      typeof override?.version === 'string' && override.version.trim()
        ? override.version.trim()
        : DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.version,
    label:
      typeof override?.label === 'string' && override.label.trim()
        ? override.label.trim()
        : DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.label,
    hardFilters: Object.freeze({
      ...DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.hardFilters,
      ...(override?.hardFilters ?? {}),
    }),
    lexical: Object.freeze({
      ...DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.lexical,
      ...(override?.lexical ?? {}),
    }),
    hybrid: Object.freeze({
      ...DEFAULT_SEARCH_RANKING_WEIGHTS_PACK.hybrid,
      ...(override?.hybrid ?? {}),
    }),
  });
}

export function resolveSearchRankingWeightsPack(
  pack?: SearchRankingWeightsPack | null,
): SearchRankingWeightsPack {
  return pack ?? DEFAULT_SEARCH_RANKING_WEIGHTS_PACK;
}

function clampImportanceDelta(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(0.5, Math.max(-0.5, value));
}

function effectiveImportance(
  importance: number,
  personalization?: EffectiveMemoryPersonalization | null,
): number {
  return clamp01(importance + clampImportanceDelta(personalization?.importanceDelta));
}

function baseAuthorityMultiplier(status?: string | null): number {
  switch (status as MemoryStatus | undefined) {
    case 'verified':
      return 1.15;
    case 'active':
      return 1.08;
    case 'candidate':
      return 1;
    default:
      return 1;
  }
}

export function baseConflictPenaltyMultiplier(status?: string | null): number {
  switch (status as MemoryStatus | undefined) {
    case 'disputed':
      return 0.7;
    case 'superseded':
    case 'retracted':
    case 'deleted':
      return 0.4;
    default:
      return 1;
  }
}

export function authorityMultiplier(
  status?: string | null,
  pack?: SearchRankingWeightsPack | null,
): number {
  const weights = resolveSearchRankingWeightsPack(pack);
  return (
    blendTowardsNeutral(
      baseAuthorityMultiplier(status),
      weights.lexical.authorityWeight,
    ) *
    blendTowardsNeutral(
      baseConflictPenaltyMultiplier(status),
      weights.lexical.conflictPenaltyWeight,
    )
  );
}

export function importanceMultiplier(
  importance: number,
  personalization?: EffectiveMemoryPersonalization | null,
  pack?: SearchRankingWeightsPack | null,
): number {
  const weights = resolveSearchRankingWeightsPack(pack);
  return blendTowardsNeutral(
    effectiveImportance(importance, personalization),
    weights.lexical.importanceWeight,
  );
}

export function pinnedScoreMultiplier(
  personalization?: EffectiveMemoryPersonalization | null,
  pack?: SearchRankingWeightsPack | null,
): number {
  if (!personalization?.pinned) {
    return 1;
  }
  const weights = resolveSearchRankingWeightsPack(pack);
  return blendTowardsNeutral(
    DEFAULT_PINNED_SCORE_MULTIPLIER,
    weights.lexical.pinnedWeight,
  );
}

export function recencyMultiplier(
  recordedAt?: string | null,
  pack?: SearchRankingWeightsPack | null,
): number {
  const weights = resolveSearchRankingWeightsPack(pack);
  if (weights.lexical.recencyWeight <= 0 || !recordedAt) {
    return 1;
  }
  const recordedAtMs = Date.parse(recordedAt);
  if (Number.isNaN(recordedAtMs)) {
    return 1;
  }
  const halfLifeDays = nonNegative(weights.lexical.recencyHalfLifeDays, 30);
  if (halfLifeDays <= 0) {
    return 1;
  }
  const ageDays = Math.max(0, (Date.now() - recordedAtMs) / 86_400_000);
  const base = Math.pow(0.5, ageDays / halfLifeDays);
  return blendTowardsNeutral(base, weights.lexical.recencyWeight);
}

export function hybridRankWeights(
  pack?: SearchRankingWeightsPack | null,
): [number, number] {
  const weights = resolveSearchRankingWeightsPack(pack);
  return [
    nonNegative(weights.hybrid.lexicalRankWeight, 1),
    nonNegative(weights.hybrid.vectorRankWeight, 1),
  ];
}

export function vectorSimilarityTieBreakWeight(
  pack?: SearchRankingWeightsPack | null,
): number {
  const weights = resolveSearchRankingWeightsPack(pack);
  return nonNegative(weights.hybrid.vectorSimilarityTieBreakWeight, 0.01);
}

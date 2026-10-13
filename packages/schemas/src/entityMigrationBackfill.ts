import type { EntityClass } from './entityGraph.js';

export const OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK_VERSION =
  'm17-s04-v1' as const;

export const M17_ENTITY_GRAPH_TABLES = [
  'entities',
  'entity_aliases',
  'entity_edges',
  'memory_entities',
] as const;

export type BackfillableMemoryType = 'decision' | 'task' | 'idea';

/**
 * Only lossless memory-type mappings are eligible for automatic entity
 * creation. Other memories receive a project-context link and remain intact.
 */
export function memoryTypeToBackfillEntityClass(
  memoryType: string,
): EntityClass | null {
  if (memoryType === 'decision' || memoryType === 'task' || memoryType === 'idea') {
    return memoryType;
  }
  return null;
}

export const OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK = {
  version: OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK_VERSION,
  roadmapSections: ['17.4', 'entity-migration-backfill'],
  tables: M17_ENTITY_GRAPH_TABLES,
  automaticMemoryEntityClasses: ['decision', 'task', 'idea'] as const,
  acceptance: {
    additiveProjectionOnly: true,
    preserveMemoryIds: true,
    preserveSourceEventIds: true,
    idempotentBackfill: true,
    projectContextCoverageRequired: true,
    deletedMemoriesExcluded: true,
    effectiveProjectRoutingRequired: true,
    everyEdgeRequiresEvidence: true,
  },
  invariants: {
    stableEntityIds: true,
    noFreeTextEntityGuessing: true,
    graphTablesRlsForced: true,
    directClientTableGrantsRevoked: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveEntityGraphPassFromMocks: false,
  },
} as const;

import { describe, expect, it } from 'vitest';
import {
  M17_ENTITY_GRAPH_TABLES,
  OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK,
  memoryTypeToBackfillEntityClass,
} from './entityMigrationBackfill.js';

describe('M17.4 entity migration and backfill pack', () => {
  it('maps only lossless memory types to entity classes', () => {
    expect(memoryTypeToBackfillEntityClass('decision')).toBe('decision');
    expect(memoryTypeToBackfillEntityClass('task')).toBe('task');
    expect(memoryTypeToBackfillEntityClass('idea')).toBe('idea');
    expect(memoryTypeToBackfillEntityClass('fact')).toBeNull();
    expect(memoryTypeToBackfillEntityClass('event')).toBeNull();
  });

  it('publishes the additive, provenance-preserving graph contract', () => {
    expect(M17_ENTITY_GRAPH_TABLES).toEqual([
      'entities',
      'entity_aliases',
      'entity_edges',
      'memory_entities',
    ]);
    expect(
      OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK.acceptance.preserveMemoryIds,
    ).toBe(true);
    expect(
      OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK.acceptance.everyEdgeRequiresEvidence,
    ).toBe(true);
    expect(
      OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK.invariants.noFreeTextEntityGuessing,
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_ENTITY_CLASSES,
  OFFICIAL_ENTITY_EDGE_TYPES,
  OFFICIAL_M17_ENTITY_GRAPH_PACK,
  OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION,
  decideEntityMerge,
  decideEntitySplit,
  entityGraphIdempotencyKey,
  entityStableId,
  validateGraphAssertion,
} from './entityGraph.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M17.1 entity graph foundation pack', () => {
  it('publishes entity classes and edge types without live graph E2E PASS', () => {
    expect(OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION).toBe('m17-s01-v1');
    expect(OFFICIAL_ENTITY_CLASSES).toHaveLength(18);
    expect(OFFICIAL_ENTITY_EDGE_TYPES).toHaveLength(12);
    expect(OFFICIAL_M17_ENTITY_GRAPH_PACK.invariants).toMatchObject({
      graphAssertionsRequireEvidence: true,
      claimLiveGraphE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('blocks accidental cross-project merges and requires evidence', () => {
    expect(
      decideEntityMerge({
        projectId,
        left: {
          stableId: 'entity:person:github:alex',
          class: 'person',
          projectId: '11111111-1111-4111-8111-111111111111',
        },
        right: {
          stableId: 'entity:person:contacts:alex',
          class: 'person',
          projectId: '22222222-2222-4222-8222-222222222222',
        },
      }).action,
    ).toBe('reject');

    expect(
      decideEntityMerge({
        projectId,
        left: {
          stableId: 'entity:repository:github:repo-a',
          class: 'repository',
          aliases: ['sasha-memory-os'],
        },
        right: {
          stableId: 'entity:repository:github:repo-b',
          class: 'repository',
          aliases: ['sasha-memory-os'],
        },
        sharedAlias: 'sasha-memory-os',
      }).action,
    ).toBe('merge');

    expect(
      decideEntitySplit({
        projectId,
        entity: { stableId: 'entity:person:github:alex', class: 'person' },
        distinctEvidenceGroups: 1,
      }).action,
    ).toBe('reject');

    expect(
      validateGraphAssertion({
        projectId,
        edgeType: 'works_on',
        evidence: [],
      }).ok,
    ).toBe(false);

    expect(
      validateGraphAssertion({
        projectId,
        edgeType: 'works_on',
        evidence: [{ sourceRef: 'memory:abc', memoryId: 'abc' }],
      }).ok,
    ).toBe(true);

    expect(entityStableId({
      class: 'project',
      source: 'memory_os',
      sourceRef: '44444444-4444-4444-8444-444444444401',
    })).toBe('entity:project:memory_os:44444444-4444-4444-8444-444444444401');

    expect(
      entityGraphIdempotencyKey({
        edgeType: 'belongs_to',
        fromStableId: 'entity:file:drive:1',
        toStableId: 'entity:project:memory_os:4444',
        sourceRef: 'drive:file:1',
      }),
    ).toBe('edge:belongs_to:entity:file:drive:1->entity:project:memory_os:4444:drive:file:1');
  });
});

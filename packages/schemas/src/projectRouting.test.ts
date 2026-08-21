import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_PROJECT_ROUTING_PACK,
  OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION,
  UNCLASSIFIED_PROJECT_ROUTE,
  buildCollectionBindingSignal,
  buildExplicitProjectSignal,
  resolveProjectRoute,
} from './projectRouting.js';

const projectA = '44444444-4444-4444-8444-444444444401';
const projectB = '55555555-5555-4555-8555-555555555501';

describe('M15.3 project routing pack', () => {
  it('publishes fail-closed routing invariants', () => {
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION).toBe('m15-s03-v1');
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK.unclassifiedRoute).toBe(
      UNCLASSIFIED_PROJECT_ROUTE,
    );
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK.invariants).toMatchObject({
      neverUseDefaultProjectFallback: true,
      neverUseAistroykaFallback: true,
      lowConfidenceRoutesToUnclassified: true,
      modeAToolCount: 7,
    });
  });

  it('routes high-confidence explicit/collection signals and rejects conflicts', () => {
    const routed = resolveProjectRoute({
      signals: [
        buildExplicitProjectSignal(projectA),
        buildCollectionBindingSignal({
          collectionId: 'repo/a',
          projectId: projectA,
        }),
      ],
    });
    expect(routed.outcome).toBe('routed');
    if (routed.outcome === 'routed') {
      expect(routed.projectId).toBe(projectA);
      expect(routed.confidence).toBeGreaterThanOrEqual(0.8);
    }

    const conflict = resolveProjectRoute({
      signals: [
        buildCollectionBindingSignal({ collectionId: 'repo/a', projectId: projectA }),
        {
          kind: 'entity_alias',
          projectId: projectB,
          weight: 0.85,
          evidence: 'alias matched project B',
        },
      ],
    });
    expect(conflict.outcome).toBe('unclassified');
    if (conflict.outcome === 'unclassified') {
      expect(conflict.reason).toBe('conflicting_projects');
      expect(conflict.projectId).toBe(UNCLASSIFIED_PROJECT_ROUTE);
    }
  });

  it('fails closed on missing/low-confidence signals and rejects AISTROYKA fallback', () => {
    expect(
      resolveProjectRoute({ signals: [] }).outcome,
    ).toBe('unclassified');

    const low = resolveProjectRoute({
      signals: [
        {
          kind: 'recent_context',
          projectId: projectA,
          weight: 0.2,
          evidence: 'weak recent mention',
        },
      ],
    });
    expect(low.outcome).toBe('unclassified');

    const aistroyka = resolveProjectRoute({
      signals: [buildExplicitProjectSignal('aistroyka')],
    });
    expect(aistroyka.outcome).toBe('unclassified');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M17_ENTITY_RESOLUTION_PACK,
  resolveEntityCandidate,
  type EntityClass,
  type EntityResolutionSignal,
} from '@memory-os/schemas';

const fixturePath = resolve(
  import.meta.dirname,
  '../fixtures/entity-graph/m17-s02-v1/golden-entity-resolution-cases.json',
);

const projectId = '44444444-4444-4444-8444-444444444401';

type GoldenCase = {
  id: string;
  entityClass: EntityClass;
  signals: EntityResolutionSignal[];
  expectedOutcome: 'resolved' | 'ambiguous' | 'unresolved';
  expectedStableId?: string;
  expectedReason?: string;
};

describe('M17.2 golden entity resolution set', () => {
  it('meets >=95% precision on the approved golden resolution fixture', () => {
    const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(20);

    let correct = 0;
    for (const item of cases) {
      const decision = resolveEntityCandidate({
        projectId,
        entityClass: item.entityClass,
        signals: item.signals,
      });

      const ok =
        decision.outcome === item.expectedOutcome &&
        (item.expectedOutcome !== 'resolved' ||
          ('stableId' in decision && decision.stableId === item.expectedStableId)) &&
        (item.expectedOutcome === 'resolved' ||
          ('reason' in decision && decision.reason === item.expectedReason));

      if (ok) correct += 1;
      else {
        expect.soft({ id: item.id, decision }, `case ${item.id}`).toMatchObject({
          decision: {
            outcome: item.expectedOutcome,
          },
        });
      }
    }

    const precision = correct / cases.length;
    expect(precision).toBeGreaterThanOrEqual(
      OFFICIAL_M17_ENTITY_RESOLUTION_PACK.acceptance.goldenPrecisionTarget,
    );
  });
});

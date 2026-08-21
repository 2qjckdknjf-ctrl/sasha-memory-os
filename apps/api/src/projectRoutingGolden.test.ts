import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_PROJECT_ROUTING_PACK,
  resolveProjectRoute,
  type ProjectRoutingSignal,
} from '@memory-os/schemas';

const fixturePath = resolve(
  import.meta.dirname,
  '../fixtures/project-routing/m15-s03-v1/golden-routing-cases.json',
);

type GoldenCase = {
  id: string;
  signals: ProjectRoutingSignal[];
  expectedOutcome: 'routed' | 'unclassified';
  expectedProjectId: string;
};

describe('M15.3 golden project routing set', () => {
  it('meets >=95% precision on the approved golden routing fixture', () => {
    const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(20);

    let correct = 0;
    for (const item of cases) {
      const decision = resolveProjectRoute({ signals: item.signals });
      const ok =
        decision.outcome === item.expectedOutcome &&
        decision.projectId === item.expectedProjectId;
      if (ok) correct += 1;
      else {
        // Keep failure detail readable in CI.
        expect.soft(
          { id: item.id, decision },
          `case ${item.id}`,
        ).toMatchObject({
          decision: {
            outcome: item.expectedOutcome,
            projectId: item.expectedProjectId,
          },
        });
      }
    }

    const precision = correct / cases.length;
    expect(precision).toBeGreaterThanOrEqual(
      OFFICIAL_M15_PROJECT_ROUTING_PACK.acceptance.goldenPrecisionTarget,
    );
  });
});

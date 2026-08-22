import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M17_ENTITY_GRAPH_PACK,
  OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION,
  decideEntityMerge,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const fixturePath = resolve(
  root,
  'apps/api/fixtures/entity-graph/m17-s01-v1/golden-entity-merge-cases.json',
);

type GoldenCase = {
  id: string;
  left: {
    stableId: string;
    class: 'person' | 'project' | 'company' | 'repository' | 'task';
    aliases?: string[];
    projectId?: string;
  };
  right: {
    stableId: string;
    class: 'person' | 'project' | 'company' | 'repository' | 'task';
    aliases?: string[];
    projectId?: string;
  };
  sharedAlias: string | null;
  expectedAction: 'merge' | 'reject' | 'review';
};

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M17 Slice 01 entity graph pack', () => {
  it('publishes entity graph foundation without live graph E2E PASS', () => {
    expect(OFFICIAL_M17_ENTITY_GRAPH_PACK_VERSION).toBe('m17-s01-v1');
    expect(
      OFFICIAL_M17_ENTITY_GRAPH_PACK.invariants.claimLiveGraphE2EPassFromMocks,
    ).toBe(false);
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('matches golden entity merge fixture', () => {
    const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(5);
    for (const item of cases) {
      const decision = decideEntityMerge({
        projectId,
        left: item.left,
        right: item.right,
        sharedAlias: item.sharedAlias,
      });
      expect(decision.action, item.id).toBe(item.expectedAction);
    }
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M17_SLICE_01.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m17-s01-v1`');
    expect(docsReadme).toContain('engineering/M17_SLICE_01.md');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_PROJECT_ROUTING_PACK,
  OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION,
  UNCLASSIFIED_PROJECT_ROUTE,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 03 project routing pack', () => {
  it('publishes fail-closed UNCLASSIFIED routing contract', () => {
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION).toBe('m15-s03-v1');
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK.unclassifiedRoute).toBe(
      UNCLASSIFIED_PROJECT_ROUTE,
    );
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK.acceptance.goldenPrecisionTarget).toBe(
      0.95,
    );
    expect(OFFICIAL_M15_PROJECT_ROUTING_PACK.invariants).toMatchObject({
      neverUseDefaultProjectFallback: true,
      neverUseAistroykaFallback: true,
      modeAToolCount: 7,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and golden fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_03.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m15-s03-v1`');
    expect(sliceDoc).toContain('UNCLASSIFIED');
    expect(docsReadme).toContain('engineering/M15_SLICE_03.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/project-routing/m15-s03-v1/golden-routing-cases.json',
        ),
      ),
    ).toBe(true);
  });
});

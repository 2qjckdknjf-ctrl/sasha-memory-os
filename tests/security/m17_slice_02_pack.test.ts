import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M17_ENTITY_RESOLUTION_PACK,
  OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M17 Slice 02 entity resolution pack', () => {
  it('publishes cross-source resolution without live E2E PASS', () => {
    expect(OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION).toBe('m17-s02-v1');
    expect(
      OFFICIAL_M17_ENTITY_RESOLUTION_PACK.invariants
        .claimLiveEntityResolutionE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M17_ENTITY_RESOLUTION_PACK.acceptance.goldenPrecisionTarget).toBe(
      0.95,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and golden fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M17_SLICE_02.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m17-s02-v1`');
    expect(sliceDoc).toMatch(/>=95% precision/i);
    expect(docsReadme).toContain('engineering/M17_SLICE_02.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/entity-graph/m17-s02-v1/golden-entity-resolution-cases.json',
        ),
      ),
    ).toBe(true);
  });
});

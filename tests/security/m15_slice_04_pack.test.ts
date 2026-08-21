import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_CANONICALIZATION_PACK,
  OFFICIAL_M15_CANONICALIZATION_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 04 canonicalization pack', () => {
  it('publishes authority-aware dedupe contract', () => {
    expect(OFFICIAL_M15_CANONICALIZATION_PACK_VERSION).toBe('m15-s04-v1');
    expect(OFFICIAL_M15_CANONICALIZATION_PACK.acceptance.canonicalDuplicateRateMax).toBe(
      0.01,
    );
    expect(OFFICIAL_M15_CANONICALIZATION_PACK.invariants).toMatchObject({
      preserveSupersededByChain: true,
      preserveProvenanceToSourceEvents: true,
      modeAToolCount: 7,
      neverUseDefaultProjectFallback: true,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_04.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m15-s04-v1`');
    expect(sliceDoc).toContain('Authority matrix');
    expect(docsReadme).toContain('engineering/M15_SLICE_04.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/canonicalization/m15-s04-v1/canonicalization-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  APPLE_CAPABILITY_MATRIX,
  OFFICIAL_M16_APPLE_FEASIBILITY_PACK,
  OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M16 Slice 01 Apple feasibility pack', () => {
  it('publishes feasibility matrix without live device E2E PASS', () => {
    expect(OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION).toBe('m16-s01-v1');
    expect(APPLE_CAPABILITY_MATRIX).toHaveLength(6);
    expect(
      OFFICIAL_M16_APPLE_FEASIBILITY_PACK.invariants.claimLiveDeviceE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M16_APPLE_FEASIBILITY_PACK.decision).toMatch(/companion/i);
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M16_SLICE_01.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m16-s01-v1`');
    expect(sliceDoc).toMatch(/Companion-required/i);
    expect(docsReadme).toContain('engineering/M16_SLICE_01.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/apple-feasibility/m16-s01-v1/matrix-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

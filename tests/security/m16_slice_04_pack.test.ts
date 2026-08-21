import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M16_PHOTOS_PACK,
  OFFICIAL_M16_PHOTOS_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M16 Slice 04 Photos pack', () => {
  it('publishes photos pack without live PhotoKit E2E PASS', () => {
    expect(OFFICIAL_M16_PHOTOS_PACK_VERSION).toBe('m16-s04-v1');
    expect(
      OFFICIAL_M16_PHOTOS_PACK.invariants.claimLivePhotoKitE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M16_PHOTOS_PACK.defaults.allowSilentBulkSemanticAnalysis).toBe(
      false,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M16_SLICE_04.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m16-s04-v1`');
    expect(sliceDoc).toMatch(/silent bulk semantic analysis/i);
    expect(docsReadme).toContain('engineering/M16_SLICE_04.md');
    expect(
      existsSync(
        resolve(root, 'apps/api/fixtures/photos/m16-s04-v1/photos-manifest.json'),
      ),
    ).toBe(true);
  });
});

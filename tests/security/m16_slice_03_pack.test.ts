import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK,
  OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M16 Slice 03 iCloud Drive / Files pack', () => {
  it('publishes files pack without live picker E2E PASS', () => {
    expect(OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION).toBe('m16-s03-v1');
    expect(
      OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK.invariants.claimLiveFilesPickerE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK.defaults.allowFullIcloudWalk).toBe(
      false,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M16_SLICE_03.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m16-s03-v1`');
    expect(sliceDoc).toMatch(/metadata-first/i);
    expect(docsReadme).toContain('engineering/M16_SLICE_03.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/icloud-drive-files/m16-s03-v1/files-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

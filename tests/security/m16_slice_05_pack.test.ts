import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK,
  OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M16 Slice 05 personal sources pack', () => {
  it('publishes Notes/Reminders/Contacts pack without live device E2E PASS', () => {
    expect(OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK_VERSION).toBe('m16-s05-v1');
    expect(
      OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK.invariants
        .claimLiveDeviceE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M16_NOTES_REMINDERS_CONTACTS_PACK.invariants.notesNoCloudKitDump).toBe(
      true,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M16_SLICE_05.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m16-s05-v1`');
    expect(sliceDoc).toMatch(/metadata-minimal/i);
    expect(docsReadme).toContain('engineering/M16_SLICE_05.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/personal-sources/m16-s05-v1/personal-sources-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

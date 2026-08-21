import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M16_APPLE_SECURITY_PACK,
  OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M16 Slice 02 Apple companion security pack', () => {
  it('publishes security foundation without signed live E2E PASS', () => {
    expect(OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION).toBe('m16-s02-v1');
    expect(
      OFFICIAL_M16_APPLE_SECURITY_PACK.invariants
        .claimLiveSignedCompanionE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M16_APPLE_SECURITY_PACK.liveSignedCompanionE2E.statusInThisSlice).toBe(
      'contract_pass_signing_blocked',
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M16_SLICE_02.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m16-s02-v1`');
    expect(sliceDoc).toMatch(/Keychain/);
    expect(docsReadme).toContain('engineering/M16_SLICE_02.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/apple-security/m16-s02-v1/security-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

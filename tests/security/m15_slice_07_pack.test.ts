import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_CAPTURE_POLICY_PACK,
  OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 07 capture policy pack', () => {
  it('publishes capture policy without mock live E2E PASS', () => {
    expect(OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION).toBe('m15-s07-v1');
    expect(
      OFFICIAL_M15_CAPTURE_POLICY_PACK.invariants.claimLiveE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M15_CAPTURE_POLICY_PACK.liveE2E.statusInThisSlice).toBe(
      'policy_fixture_pass_live_blocked',
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_07.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m15-s07-v1`');
    expect(sliceDoc).toMatch(/preview\/apply/);
    expect(docsReadme).toContain('engineering/M15_SLICE_07.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/capture-policy/m15-s07-v1/policy-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

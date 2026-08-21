import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_LIVE_E2E_GATE_PACK,
  OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION,
  summarizeM15LiveE2EGate,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 live E2E closure pack', () => {
  it('stays BLOCKED and never claims mock live PASS', () => {
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION).toBe('m15-live-e2e-v1');
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK.overallStatus).toBe('BLOCKED');
    expect(OFFICIAL_M15_LIVE_E2E_GATE_PACK.claimPassFromMocks).toBe(false);
    expect(summarizeM15LiveE2EGate().mayAdvanceWithDocumentedLimitations).toBe(
      true,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_LIVE_E2E_CLOSURE.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m15-live-e2e-v1`');
    expect(sliceDoc).toMatch(/\*\*BLOCKED\*\*/);
    expect(docsReadme).toContain('engineering/M15_LIVE_E2E_CLOSURE.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/live-e2e/m15-live-e2e-v1/gate-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  M15_METRIC_TARGETS,
  OFFICIAL_M15_OBSERVABILITY_PACK,
  OFFICIAL_M15_OBSERVABILITY_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 08 observability pack', () => {
  it('publishes M15 metrics without mock live dashboard PASS', () => {
    expect(OFFICIAL_M15_OBSERVABILITY_PACK_VERSION).toBe('m15-s08-v1');
    expect(M15_METRIC_TARGETS).toHaveLength(9);
    expect(
      OFFICIAL_M15_OBSERVABILITY_PACK.invariants.claimLiveE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M15_OBSERVABILITY_PACK.liveE2E.statusInThisSlice).toBe(
      'metric_catalog_pass_live_dashboard_blocked',
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_08.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m15-s08-v1`');
    expect(sliceDoc).toMatch(/dead\s+letters/i);
    expect(docsReadme).toContain('engineering/M15_SLICE_08.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/observability/m15-s08-v1/metrics-manifest.json',
        ),
      ),
    ).toBe(true);
  });
});

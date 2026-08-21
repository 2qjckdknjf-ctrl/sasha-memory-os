import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK,
  OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 02 connector orchestration pack', () => {
  it('publishes versioned orchestration contract without mock live E2E PASS', () => {
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION).toBe('m15-s02-v1');
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.version).toBe('m15-s02-v1');
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.invariants).toMatchObject({
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
      allowMemoryOsDefaultProjectIdFallback: false,
      noSilentDataLossOnRecovery: true,
    });
    expect(OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.liveE2E.statusInThisSlice).toBe(
      'blocked_missing_live_credentials',
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_02.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          root,
          'apps/api/fixtures/connector-orchestration/m15-s02-v1/orchestration-manifest.json',
        ),
        'utf8',
      ),
    ) as { packVersion: string; liveE2E: { claimPassFromMocks: boolean } };

    expect(sliceDoc).toContain('Official pack version: `m15-s02-v1`');
    expect(sliceDoc).toMatch(/BLOCKED/i);
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(docsReadme).toContain('engineering/M15_SLICE_02.md');
    expect(fixture.packVersion).toBe('m15-s02-v1');
    expect(fixture.liveE2E.claimPassFromMocks).toBe(false);
    expect(
      existsSync(
        resolve(root, 'workers/connector-sync/src/orchestration.ts'),
      ),
    ).toBe(true);
  });
});

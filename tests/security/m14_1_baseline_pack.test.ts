import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION } from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14.1 baseline reconciliation pack', () => {
  it('publishes machine-readable CURRENT_STATE aligned with official packs', () => {
    const manifestPath = resolve(root, 'docs/engineering/CURRENT_STATE.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      manifestVersion: string;
      currentMilestone: string;
      completedThrough: string;
      nextSlice: string;
      officialPacks: { m14SupportOps: string };
      projectRouting: {
        allowMemoryOsDefaultProjectIdFallback: boolean;
        writesRequireExplicitProjectId: boolean;
      };
      chatgptModeA: { toolCount: number; status: string };
      readmeMustContain: string[];
    };

    expect(manifest.manifestVersion).toBe('m14.1-v1');
    expect(manifest.currentMilestone).toBe('M14.1-baseline-reconciliation');
    expect(manifest.completedThrough).toBe('M14');
    expect(manifest.nextSlice).toBe('M15.1-source-event-contract');
    expect(manifest.officialPacks.m14SupportOps).toBe(
      OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
    );
    expect(manifest.projectRouting.allowMemoryOsDefaultProjectIdFallback).toBe(
      false,
    );
    expect(manifest.projectRouting.writesRequireExplicitProjectId).toBe(true);
    expect(manifest.chatgptModeA).toMatchObject({ status: 'PASS', toolCount: 7 });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
    expect(manifest.readmeMustContain).toEqual(
      expect.arrayContaining([
        'M14.1-baseline-reconciliation',
        'docs/engineering/CURRENT_STATE.json',
        'M15.1-source-event-contract',
      ]),
    );
  });

  it('documents bounded Phase 0 scope and links CURRENT_STATE from docs map', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M14_1_BASELINE.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');

    expect(sliceDoc).toContain('Official manifest version: `m14.1-v1`');
    expect(sliceDoc).toContain('M15.1-source-event-contract');
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(sliceDoc).toMatch(/CURRENT_STATE\.json/);
    expect(docsReadme).toContain('engineering/CURRENT_STATE.json');
    expect(docsReadme).toContain('engineering/M14_1_BASELINE.md');
    expect(readme).toContain('M14.1-baseline-reconciliation');
    expect(readme).toContain('docs/engineering/CURRENT_STATE.json');
    expect(readme).not.toContain('**M7 started:**');
  });
});

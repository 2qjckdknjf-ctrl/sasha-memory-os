import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK,
  OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M15 Slice 01 source-event contract pack', () => {
  it('publishes the official pack as versioned and fail-closed', () => {
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION).toBe('m15-s01-v1');
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK.version).toBe('m15-s01-v1');
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK.roadmapSections).toEqual([
      '15.1',
      'universal-ingestion',
    ]);
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK.invariants).toMatchObject({
      appendOnlySourceEvents: true,
      duplicateDeliverySingleLogicalEvent: true,
      replaySafeIdempotency: true,
      writesRequireExplicitProjectId: true,
      allowMemoryOsDefaultProjectIdFallback: false,
      allowAistroykaFallback: false,
      modeAToolCount: 7,
      allowVerifiedWritesFromIngestAlone: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs, fixture, and migration anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M15_SLICE_01.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          root,
          'apps/api/fixtures/source-event-contract/m15-s01-v1/contract-manifest.json',
        ),
        'utf8',
      ),
    ) as { packVersion: string; invariants: Record<string, unknown> };
    const migration = resolve(
      root,
      'supabase/migrations/20260821100000_m15_slice_01_source_event_contract.sql',
    );

    expect(sliceDoc).toContain('Official pack version: `m15-s01-v1`');
    expect(sliceDoc).toContain('app.api_ingest_source_event');
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(sliceDoc).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` write fallback/i);
    expect(docsReadme).toContain('engineering/M15_SLICE_01.md');
    expect(fixture.packVersion).toBe('m15-s01-v1');
    expect(fixture.invariants.modeAToolCount).toBe(7);
    expect(fixture.invariants.writesRequireExplicitProjectId).toBe(true);
    expect(existsSync(migration)).toBe(true);
  });
});

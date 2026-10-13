import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK,
  OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const migration = resolve(
  root,
  'supabase/migrations/20261013142833_m17_slice_04_entity_graph_backfill.sql',
);
const sqlCases = resolve(
  root,
  'tests/security/m17_slice_04_entity_graph_cases.sql',
);

describe('M17 Slice 04 entity migration and backfill pack', () => {
  it('publishes the durable graph pack without claiming live production PASS', () => {
    expect(OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK_VERSION).toBe('m17-s04-v1');
    expect(
      OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK.invariants
        .claimLiveEntityGraphPassFromMocks,
    ).toBe(false);
    expect(
      OFFICIAL_M17_ENTITY_MIGRATION_BACKFILL_PACK.acceptance.idempotentBackfill,
    ).toBe(true);
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps migration, database acceptance and documentation anchors checked in', () => {
    expect(existsSync(migration)).toBe(true);
    expect(existsSync(sqlCases)).toBe(true);
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M17_SLICE_04.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m17-s04-v1`');
    expect(sliceDoc).toMatch(/idempotent/i);
    expect(sliceDoc).toMatch(/effective project/i);
    expect(docsReadme).toContain('engineering/M17_SLICE_04.md');
  });
});

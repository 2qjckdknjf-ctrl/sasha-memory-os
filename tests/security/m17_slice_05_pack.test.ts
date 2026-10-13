import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M17_LIVE_GRAPH_PACK } from '@memory-os/schemas';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../supabase/migrations/20261013145110_m17_slice_05_live_graph_retrieval_inspector.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('M17.5 live graph security pack', () => {
  it('pins the canonical traversal budget and live-evidence gate', () => {
    expect(OFFICIAL_M17_LIVE_GRAPH_PACK.version).toBe('m17-s05-v1');
    expect(OFFICIAL_M17_LIVE_GRAPH_PACK.budgets).toMatchObject({
      maxHops: 2,
      maxNodes: 24,
      maxEdges: 48,
      minConfidence: 0.7,
    });
    expect(OFFICIAL_M17_LIVE_GRAPH_PACK.invariants.claimLivePassFromMocks).toBe(false);
  });

  it('requires API secret, subject binding, explicit project and evidence', () => {
    expect(migration).toContain('PERFORM app.assert_api_secret(p_secret)');
    expect(migration).toContain('PERFORM app.with_subject(p_subject_id)');
    expect(migration).toContain("RAISE EXCEPTION 'project_id required'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.can_read_graph_source');
    expect(migration).toContain('source_memory.sensitivity');
    expect(migration).toContain('source_event.sensitivity');
    expect(migration).toContain("OR ee.evidence <> '{}'::jsonb");
    expect(migration).not.toContain("'44444444-4444-4444-8444-444444444401'");
  });

  it('keeps public graph RPCs server-only and traversal bounded', () => {
    expect(migration).toContain('p_max_hops > 2');
    expect(migration).toContain('p_max_nodes > 24');
    expect(migration).toContain('p_max_edges > 48');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });
});

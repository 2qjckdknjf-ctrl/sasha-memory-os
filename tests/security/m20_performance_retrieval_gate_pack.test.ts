import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const repoFile = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

describe('M20.3 performance and retrieval gate', () => {
  it('freezes quality, latency, load, routing, and M13 invariants', () => {
    expect(OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK).toMatchObject({
      version: 'm20-s03-v1',
      thresholds: {
        frozenCaseCount: 200,
        recallAt10Floor: 0.95,
        aclLeakageCasesMax: 0,
        soakOperationsFloor: 60,
        hybridP95Ms: 2_000,
        agenticP95Ms: 8_000,
      },
      invariants: {
        preserveM13RankingVersion: true,
        agenticRetrievalMayWrite: false,
        idempotencyScopeMismatchMustFail: true,
        explicitProjectScopeRequired: true,
        liveGateIsReadOnly: true,
      },
    });
  });

  it('wires every gate into mandatory CI and current state', () => {
    const ci = repoFile('.github/workflows/ci.yml');
    const ephemeral = repoFile('scripts/ci-ephemeral-shared-memory-smoke.sh');
    const migration = repoFile(
      'supabase/migrations/20261015220000_m20_capture_idempotency_scope_guard.sql',
    );
    const routingLoad = repoFile('scripts/m20-routing-dedupe-load.sh');
    const liveRetrieval = repoFile('apps/api/src/m20LiveRetrieval.ts');
    const performanceHarness = repoFile('apps/api/src/m20PerformanceHarness.ts');
    const edgeMcp = repoFile('supabase/functions/memory-mcp/index.ts');
    const edgeEmbeddingCache = repoFile(
      'supabase/functions/memory-mcp/queryEmbeddingCache.ts',
    );
    const docs = repoFile('docs/engineering/M20_SLICE_03_PERFORMANCE_RETRIEVAL.md');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(ephemeral).toContain('m20-routing-dedupe-load.sh');
    expect(ephemeral).toContain('m20-performance-soak.sh');
    expect(ci).toContain('m20-live-retrieval.sh');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('idempotency key conflict');
    expect(routingLoad).toContain('concurrent_calls=16');
    expect(routingLoad).toContain('cross_project_replay=rejected');
    expect(liveRetrieval).toContain(
      `const LIVE_READ_ONLY_SAMPLES = ${OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK.thresholds.liveReadOnlySamples}`,
    );
    expect(liveRetrieval).toContain(
      `const HYBRID_P95_THRESHOLD_MS = ${OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK.thresholds.hybridP95Ms.toLocaleString('en-US').replace(',', '_')}`,
    );
    expect(liveRetrieval).toContain('const LIVE_READ_ONLY_CONCURRENCY = 1');
    expect(performanceHarness).toContain("targetId === 'search.agentic'");
    expect(performanceHarness).toContain('thresholds.agenticP95Ms');
    expect(edgeMcp).toContain('withoutSearchEmbeddings(ranked)');
    expect(edgeMcp).toContain('embedding_vector_hq');
    expect(edgeMcp).toContain('QUERY_EMBEDDING_CACHE.getOrLoad');
    expect(edgeEmbeddingCache).toContain('maxEntries ?? 128');
    expect(edgeEmbeddingCache).toContain('ttlMs ?? 5 * 60_000');
    expect(docs).toContain('Recall@10 `1.0`');
    expect(current.officialPacks.m20PerformanceRetrieval).toBe('m20-s03-v1');
    expect(current.tests.m20PerformanceRoutingDedupeSql).toBe(
      'tests/security/m20_performance_routing_dedupe_cases.sql',
    );
  });
});

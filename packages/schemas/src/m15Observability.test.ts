import { describe, expect, it } from 'vitest';
import {
  M15_METRIC_TARGETS,
  OFFICIAL_M15_OBSERVABILITY_PACK,
  OFFICIAL_M15_OBSERVABILITY_PACK_VERSION,
  evaluateM15Metric,
  evaluateM15MetricSet,
  sanitizeM15MetricLogFields,
} from './m15Observability.js';

describe('M15.8 observability / SLO pack', () => {
  it('publishes metric catalog without claiming live dashboard PASS', () => {
    expect(OFFICIAL_M15_OBSERVABILITY_PACK_VERSION).toBe('m15-s08-v1');
    expect(M15_METRIC_TARGETS).toHaveLength(9);
    expect(OFFICIAL_M15_OBSERVABILITY_PACK.metrics).toEqual(
      M15_METRIC_TARGETS.map((t) => t.id),
    );
    expect(OFFICIAL_M15_OBSERVABILITY_PACK.invariants).toMatchObject({
      noSensitiveBodiesInLogs: true,
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(OFFICIAL_M15_OBSERVABILITY_PACK.alertOwnership.runbookPack).toBe(
      'm14-s05-v1',
    );
  });

  it('evaluates suggested targets and redacts sensitive log fields', () => {
    expect(
      evaluateM15Metric({ id: 'duplicate_rate', value: 0.005 }).withinSuggestedTarget,
    ).toBe(true);
    expect(
      evaluateM15Metric({ id: 'duplicate_rate', value: 0.02 }).withinSuggestedTarget,
    ).toBe(false);
    expect(
      evaluateM15Metric({ id: 'sync_success_ratio', value: 0.995 }).withinSuggestedTarget,
    ).toBe(true);
    expect(
      evaluateM15Metric({ id: 'search_latency_ms', value: 900 }).withinSuggestedTarget,
    ).toBe(false);

    const set = evaluateM15MetricSet([
      { id: 'ingestion_lag_ms', value: 10_000 },
      { id: 'unclassified_rate', value: 0.02 },
      { id: 'stale_project_count', value: 0 },
      { id: 'dead_letter_count', value: 0 },
      { id: 'routing_confidence', value: 0.91 },
      { id: 'consolidation_latency_ms', value: 30_000 },
      { id: 'sync_success_ratio', value: 0.99 },
      { id: 'duplicate_rate', value: 0.005 },
      { id: 'search_latency_ms', value: 400 },
    ]);
    expect(set.allWithinSuggested).toBe(true);

    expect(
      sanitizeM15MetricLogFields({
        metricId: 'search_latency_ms',
        value: 400,
        memory_content: 'secret body',
        api_token: 'abc',
      }),
    ).toEqual({
      metricId: 'search_latency_ms',
      value: 400,
      memory_content: '[REDACTED]',
      api_token: '[REDACTED]',
    });
  });
});

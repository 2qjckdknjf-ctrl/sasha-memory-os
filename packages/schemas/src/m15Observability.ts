export const OFFICIAL_M15_OBSERVABILITY_PACK_VERSION = 'm15-s08-v1' as const;

export type M15MetricId =
  | 'ingestion_lag_ms'
  | 'sync_success_ratio'
  | 'routing_confidence'
  | 'unclassified_rate'
  | 'duplicate_rate'
  | 'consolidation_latency_ms'
  | 'search_latency_ms'
  | 'stale_project_count'
  | 'dead_letter_count';

export type M15MetricTarget = {
  id: M15MetricId;
  description: string;
  kind: 'gauge' | 'ratio' | 'latency_p95' | 'count';
  /** Suggested production target; ratify during ops rollout. */
  suggestedTarget: number;
  unit: 'ms' | 'ratio' | 'count';
};

export const M15_METRIC_TARGETS: readonly M15MetricTarget[] = [
  {
    id: 'ingestion_lag_ms',
    description: 'Webhook/polling ingestion lag p95',
    kind: 'latency_p95',
    suggestedTarget: 60_000,
    unit: 'ms',
  },
  {
    id: 'sync_success_ratio',
    description: 'Connector sync success ratio over rolling window',
    kind: 'ratio',
    suggestedTarget: 0.99,
    unit: 'ratio',
  },
  {
    id: 'routing_confidence',
    description: 'Mean project-routing confidence on classified events',
    kind: 'gauge',
    suggestedTarget: 0.9,
    unit: 'ratio',
  },
  {
    id: 'unclassified_rate',
    description: 'Share of events routed to UNCLASSIFIED',
    kind: 'ratio',
    suggestedTarget: 0.05,
    unit: 'ratio',
  },
  {
    id: 'duplicate_rate',
    description: 'Canonical duplicate rate after authority dedupe',
    kind: 'ratio',
    suggestedTarget: 0.01,
    unit: 'ratio',
  },
  {
    id: 'consolidation_latency_ms',
    description: 'Consolidation job latency p95',
    kind: 'latency_p95',
    suggestedTarget: 120_000,
    unit: 'ms',
  },
  {
    id: 'search_latency_ms',
    description: 'Hybrid search latency p95',
    kind: 'latency_p95',
    suggestedTarget: 800,
    unit: 'ms',
  },
  {
    id: 'stale_project_count',
    description: 'Projects with open stale_project_state alerts',
    kind: 'count',
    suggestedTarget: 0,
    unit: 'count',
  },
  {
    id: 'dead_letter_count',
    description: 'Open dead-letter / DLQ items requiring owner action',
    kind: 'count',
    suggestedTarget: 0,
    unit: 'count',
  },
] as const;

export const OFFICIAL_M15_OBSERVABILITY_PACK = {
  version: OFFICIAL_M15_OBSERVABILITY_PACK_VERSION,
  roadmapSections: ['15.8', 'observability-slos'],
  metrics: M15_METRIC_TARGETS.map((t) => t.id),
  structuredLogs: {
    redactBodiesAndTokens: true,
    reuseM14RedactionHelpers: true,
  },
  alertOwnership: {
    tiedToM14IncidentRunbooks: true,
    runbookPack: 'm14-s05-v1',
  },
  invariants: {
    noSensitiveBodiesInLogs: true,
    noTokensInLogs: true,
    targetsAreSuggestedNotHardFailUntilRatified: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveE2EPassFromMocks: false,
  },
  liveE2E: {
    statusInThisSlice: 'metric_catalog_pass_live_dashboard_blocked',
    note: 'Metric catalog + evaluation fixtures PASS; live production dashboard wiring remains ops follow-up.',
  },
} as const;

export type MetricSample = {
  id: M15MetricId;
  value: number;
};

export type MetricEvaluation = {
  id: M15MetricId;
  value: number;
  suggestedTarget: number;
  withinSuggestedTarget: boolean;
};

function targetFor(id: M15MetricId): M15MetricTarget {
  const found = M15_METRIC_TARGETS.find((t) => t.id === id);
  if (!found) {
    throw new Error(`unknown metric id: ${id}`);
  }
  return found;
}

export function evaluateM15Metric(sample: MetricSample): MetricEvaluation {
  const target = targetFor(sample.id);
  let within: boolean;
  switch (target.kind) {
    case 'ratio':
    case 'gauge':
      // lower unclassified/duplicate is better; higher sync/routing is better
      if (sample.id === 'unclassified_rate' || sample.id === 'duplicate_rate') {
        within = sample.value <= target.suggestedTarget;
      } else {
        within = sample.value >= target.suggestedTarget;
      }
      break;
    case 'latency_p95':
    case 'count':
      within = sample.value <= target.suggestedTarget;
      break;
    default: {
      const _exhaustive: never = target.kind;
      void _exhaustive;
      within = false;
      break;
    }
  }
  return {
    id: sample.id,
    value: sample.value,
    suggestedTarget: target.suggestedTarget,
    withinSuggestedTarget: within,
  };
}

export function evaluateM15MetricSet(samples: MetricSample[]): {
  evaluations: MetricEvaluation[];
  allWithinSuggested: boolean;
} {
  const evaluations = samples.map(evaluateM15Metric);
  return {
    evaluations,
    allWithinSuggested: evaluations.every((e) => e.withinSuggestedTarget),
  };
}

/** Metadata-only structured log field filter (no bodies/tokens). */
export function sanitizeM15MetricLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const blocked =
    /(?:^|[_-])(token|secret|password|authorization|cookie|content|text|body|payload|prompt|memory)(?:[_-]|$)/i;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (blocked.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

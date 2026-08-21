export const OFFICIAL_M15_FRESHNESS_PACK_VERSION = 'm15-s05-v1' as const;

export type FreshnessSourceKind =
  | 'github'
  | 'google_drive'
  | 'gmail'
  | 'google_calendar'
  | 'agent_writeback'
  | 'manual';

export type FreshnessAlertKind =
  | 'stale_project_state'
  | 'stale_source'
  | 'stalled_worker'
  | 'stale_source_cursor';

export type SourceWatermark = {
  source: FreshnessSourceKind;
  projectId: string;
  lastObservedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastCanonicalUpdateAt: string | null;
  cursorUpdatedAt?: string | null;
};

export type FreshnessSla = {
  /** Max age in ms before a watermark is considered stale. */
  maxLagMs: number;
};

export const DEFAULT_FRESHNESS_SLA: Record<FreshnessSourceKind, FreshnessSla> = {
  github: { maxLagMs: 5 * 60_000 },
  google_drive: { maxLagMs: 5 * 60_000 },
  gmail: { maxLagMs: 5 * 60_000 },
  google_calendar: { maxLagMs: 5 * 60_000 },
  agent_writeback: { maxLagMs: 60_000 },
  manual: { maxLagMs: 24 * 60 * 60_000 },
};

export const OFFICIAL_M15_FRESHNESS_PACK = {
  version: OFFICIAL_M15_FRESHNESS_PACK_VERSION,
  roadmapSections: ['15.5', 'freshness-reconciliation'],
  alertKinds: [
    'stale_project_state',
    'stale_source',
    'stalled_worker',
    'stale_source_cursor',
  ] as const,
  invariants: {
    detectGithubChangedButSnapshotStale: true,
    clearAlertsAfterRepair: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveE2EPassFromMocks: false,
  },
  liveE2E: {
    statusInThisSlice: 'blocked_missing_live_credentials',
    note: 'Fixture stale-state detection PASS; live freshness dashboard E2E remains blocked.',
  },
} as const;

export type FreshnessAlert = {
  kind: FreshnessAlertKind;
  source: FreshnessSourceKind;
  projectId: string;
  lagMs: number;
  thresholdMs: number;
  message: string;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateSourceFreshness(input: {
  watermark: SourceWatermark;
  nowMs?: number;
  sla?: FreshnessSla;
}): FreshnessAlert[] {
  const now = input.nowMs ?? Date.now();
  const sla = input.sla ?? DEFAULT_FRESHNESS_SLA[input.watermark.source];
  const alerts: FreshnessAlert[] = [];
  const { watermark } = input;

  const lastSync = parseTime(watermark.lastSuccessfulSyncAt);
  if (lastSync === null || now - lastSync > sla.maxLagMs) {
    alerts.push({
      kind: 'stale_source',
      source: watermark.source,
      projectId: watermark.projectId,
      lagMs: lastSync === null ? Number.POSITIVE_INFINITY : now - lastSync,
      thresholdMs: sla.maxLagMs,
      message:
        lastSync === null
          ? `${watermark.source} has never successfully synced`
          : `${watermark.source} sync lag exceeded SLA`,
    });
  }

  const lastObserved = parseTime(watermark.lastObservedAt);
  const lastCanonical = parseTime(watermark.lastCanonicalUpdateAt);
  if (
    lastObserved !== null &&
    (lastCanonical === null || lastCanonical + 1_000 < lastObserved)
  ) {
    const lag =
      lastCanonical === null ? Number.POSITIVE_INFINITY : lastObserved - lastCanonical;
    if (lag > sla.maxLagMs || lastCanonical === null) {
      alerts.push({
        kind: 'stale_project_state',
        source: watermark.source,
        projectId: watermark.projectId,
        lagMs: lag,
        thresholdMs: sla.maxLagMs,
        message: `${watermark.source} observed newer source truth than canonical project snapshot`,
      });
    }
  }

  const cursorAt = parseTime(watermark.cursorUpdatedAt ?? null);
  if (cursorAt !== null && now - cursorAt > sla.maxLagMs * 2) {
    alerts.push({
      kind: 'stale_source_cursor',
      source: watermark.source,
      projectId: watermark.projectId,
      lagMs: now - cursorAt,
      thresholdMs: sla.maxLagMs * 2,
      message: `${watermark.source} cursor watermark is stale`,
    });
  }

  return alerts;
}

export function evaluateWorkerFreshness(input: {
  projectId: string;
  source: FreshnessSourceKind;
  lastWorkerHeartbeatAt: string | null;
  nowMs?: number;
  maxSilenceMs?: number;
}): FreshnessAlert[] {
  const now = input.nowMs ?? Date.now();
  const maxSilence = input.maxSilenceMs ?? 10 * 60_000;
  const beat = parseTime(input.lastWorkerHeartbeatAt);
  if (beat !== null && now - beat <= maxSilence) return [];
  return [
    {
      kind: 'stalled_worker',
      source: input.source,
      projectId: input.projectId,
      lagMs: beat === null ? Number.POSITIVE_INFINITY : now - beat,
      thresholdMs: maxSilence,
      message: 'connector worker heartbeat missing or stalled',
    },
  ];
}

/**
 * After a successful repair, drop alerts that no longer apply for the watermark.
 */
export function reconcileFreshnessAlerts(input: {
  previous: FreshnessAlert[];
  watermark: SourceWatermark;
  nowMs?: number;
  workerHeartbeatAt?: string | null;
}): FreshnessAlert[] {
  void input.previous;
  const sourceAlerts = evaluateSourceFreshness({
    watermark: input.watermark,
    nowMs: input.nowMs,
  });
  const workerAlerts = evaluateWorkerFreshness({
    projectId: input.watermark.projectId,
    source: input.watermark.source,
    lastWorkerHeartbeatAt:
      input.workerHeartbeatAt ?? input.watermark.lastSuccessfulSyncAt,
    nowMs: input.nowMs,
  });
  return [...sourceAlerts, ...workerAlerts];
}

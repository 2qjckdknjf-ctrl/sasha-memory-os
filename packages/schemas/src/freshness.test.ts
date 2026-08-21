import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_FRESHNESS_PACK,
  OFFICIAL_M15_FRESHNESS_PACK_VERSION,
  evaluateSourceFreshness,
  evaluateWorkerFreshness,
  reconcileFreshnessAlerts,
} from './freshness.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const now = Date.parse('2026-08-21T21:00:00.000Z');

describe('M15.5 freshness pack', () => {
  it('publishes freshness invariants without claiming live E2E PASS', () => {
    expect(OFFICIAL_M15_FRESHNESS_PACK_VERSION).toBe('m15-s05-v1');
    expect(OFFICIAL_M15_FRESHNESS_PACK.invariants).toMatchObject({
      detectGithubChangedButSnapshotStale: true,
      clearAlertsAfterRepair: true,
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(OFFICIAL_M15_FRESHNESS_PACK.liveE2E.statusInThisSlice).toBe(
      'blocked_missing_live_credentials',
    );
  });

  it('detects stale source, stale project snapshot, and stalled worker', () => {
    const stale = evaluateSourceFreshness({
      nowMs: now,
      watermark: {
        source: 'github',
        projectId,
        lastObservedAt: '2026-08-21T20:59:00.000Z',
        lastSuccessfulSyncAt: '2026-08-21T20:50:00.000Z',
        lastCanonicalUpdateAt: '2026-08-21T20:50:00.000Z',
        cursorUpdatedAt: '2026-08-21T20:40:00.000Z',
      },
      sla: { maxLagMs: 60_000 },
    });
    expect(stale.map((a) => a.kind).sort()).toEqual([
      'stale_project_state',
      'stale_source',
      'stale_source_cursor',
    ]);

    const worker = evaluateWorkerFreshness({
      projectId,
      source: 'github',
      lastWorkerHeartbeatAt: '2026-08-21T20:40:00.000Z',
      nowMs: now,
      maxSilenceMs: 5 * 60_000,
    });
    expect(worker[0]?.kind).toBe('stalled_worker');
  });

  it('clears alerts after repair watermarks catch up', () => {
    const previous = evaluateSourceFreshness({
      nowMs: now,
      watermark: {
        source: 'github',
        projectId,
        lastObservedAt: '2026-08-21T20:59:00.000Z',
        lastSuccessfulSyncAt: '2026-08-21T20:50:00.000Z',
        lastCanonicalUpdateAt: '2026-08-21T20:50:00.000Z',
      },
      sla: { maxLagMs: 60_000 },
    });
    expect(previous.length).toBeGreaterThan(0);

    const repaired = reconcileFreshnessAlerts({
      previous,
      nowMs: now,
      watermark: {
        source: 'github',
        projectId,
        lastObservedAt: '2026-08-21T20:59:30.000Z',
        lastSuccessfulSyncAt: '2026-08-21T20:59:30.000Z',
        lastCanonicalUpdateAt: '2026-08-21T20:59:30.000Z',
        cursorUpdatedAt: '2026-08-21T20:59:30.000Z',
      },
      workerHeartbeatAt: '2026-08-21T20:59:30.000Z',
    });
    expect(repaired).toEqual([]);
  });
});

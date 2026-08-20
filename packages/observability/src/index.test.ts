import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  getSloBudgetSnapshot,
  OFFICIAL_M14_SECURITY_REVIEW_PACK,
  OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  OFFICIAL_M14_SLO_PACK,
  OFFICIAL_M14_SLO_PACK_VERSION,
  recordHandledAvailability,
  recordSloObservation,
  resetSloObservations,
} from './index.js';

describe('observability package', () => {
  afterEach(() => {
    resetSloObservations();
    vi.restoreAllMocks();
  });

  it('publishes the official M14 SLO pack with explicit targets', () => {
    expect(OFFICIAL_M14_SLO_PACK_VERSION).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_SLO_PACK.version).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_SLO_PACK.roadmapSections).toEqual(['17.2', '17.4', '20.17']);
    expect(OFFICIAL_M14_SLO_PACK.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'api.availability',
          objective: expect.objectContaining({
            kind: 'availability',
            targetRatio: 0.995,
            errorBudgetRatio: 0.005,
          }),
        }),
        expect.objectContaining({
          id: 'mcp.availability',
          objective: expect.objectContaining({
            kind: 'availability',
            targetRatio: 0.995,
            errorBudgetRatio: 0.005,
          }),
        }),
        expect.objectContaining({
          id: 'project.state',
          objective: expect.objectContaining({
            kind: 'latency_p95',
            thresholdMs: 700,
            errorBudgetRatio: 0.05,
          }),
        }),
        expect.objectContaining({
          id: 'search.hybrid',
          objective: expect.objectContaining({
            kind: 'latency_p95',
            thresholdMs: 2_000,
            errorBudgetRatio: 0.05,
          }),
        }),
        expect.objectContaining({
          id: 'search.agentic',
          objective: expect.objectContaining({
            kind: 'latency_p95',
            thresholdMs: 8_000,
            errorBudgetRatio: 0.05,
          }),
        }),
        expect.objectContaining({
          id: 'write.receipt',
          objective: expect.objectContaining({
            kind: 'latency_p95',
            thresholdMs: 1_000,
            errorBudgetRatio: 0.05,
          }),
        }),
        expect.objectContaining({
          id: 'webhook.ack',
          objective: expect.objectContaining({
            kind: 'deadline',
            thresholdMs: 5_000,
            errorBudgetRatio: 0,
          }),
        }),
        expect.objectContaining({
          id: 'acl.leakage',
          objective: expect.objectContaining({
            kind: 'zero_tolerance',
            maxViolations: 0,
          }),
        }),
      ]),
    );
  });

  it('publishes the official M14 Slice 03 security review pack with defensive-only invariants', () => {
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION).toBe('m14-s03-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.version).toBe('m14-s03-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.roadmapSections).toEqual(['20.17']);
    expect(
      OFFICIAL_M14_SECURITY_REVIEW_PACK.checklist.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        'rls-matrix',
        'acl-default-deny',
        'mcp-unauthenticated-reject',
        'mode-a-surface',
        'no-owner-token-bypass',
        'no-aistroyka-fallback',
        'no-verified-write-or-payload-leak',
      ]),
    );
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      modeAToolCount: 7,
      requireExplicitProjectIdOnWrites: true,
      rejectUnauthenticatedMcp: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      logMemoryBodies: false,
      logTokens: false,
    });
    expect(
      OFFICIAL_M14_SECURITY_REVIEW_PACK.checklist.find(
        (item) => item.id === 'mcp-unauthenticated-reject',
      )?.evidence,
    ).toContain('apps/mcp-gateway/src/httpAuth.test.ts');
  });

  it('redacts tokens, bodies, queries, and personal content from structured logs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const log = createLogger('memory-api');

    log.info('http', {
      requestId: 'req-1',
      path: '/v1/search',
      status: 200,
      query: 'personal family travel plan',
      token: 'top-secret-token',
      text: 'memory body should never be logged',
      error: 'webhook failed with secret body',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0]?.[0];
    expect(typeof payload).toBe('string');
    expect(String(payload)).toContain('"path":"/v1/search"');
    expect(String(payload)).toContain('"status":200');
    expect(String(payload)).toContain('"query":"[REDACTED]"');
    expect(String(payload)).toContain('"token":"[REDACTED]"');
    expect(String(payload)).toContain('"text":"[REDACTED]"');
    expect(String(payload)).toContain('"error":"[REDACTED]"');
    expect(String(payload)).not.toContain('family travel');
    expect(String(payload)).not.toContain('top-secret-token');
    expect(String(payload)).not.toContain('memory body should never be logged');
  });

  it('tracks bounded in-process SLO observations without storing payload content', () => {
    recordHandledAvailability({
      targetId: 'api.availability',
      statusCode: 200,
      durationMs: 18,
    });
    recordHandledAvailability({
      targetId: 'mcp.availability',
      statusCode: 503,
      durationMs: 24,
    });
    recordSloObservation({
      targetId: 'search.hybrid',
      durationMs: 1_250,
    });
    recordSloObservation({
      targetId: 'search.hybrid',
      durationMs: 2_250,
    });
    recordSloObservation({
      targetId: 'webhook.ack',
      durationMs: 5_500,
    });
    recordSloObservation({
      targetId: 'acl.leakage',
      outcome: 'violation',
    });

    const snapshot = getSloBudgetSnapshot();
    const apiAvailability = snapshot.targets.find((target) => target.id === 'api.availability');
    const mcpAvailability = snapshot.targets.find((target) => target.id === 'mcp.availability');
    const hybridSearch = snapshot.targets.find((target) => target.id === 'search.hybrid');
    const webhookAck = snapshot.targets.find((target) => target.id === 'webhook.ack');
    const aclLeakage = snapshot.targets.find((target) => target.id === 'acl.leakage');

    expect(apiAvailability?.observations).toMatchObject({
      totalCount: 1,
      errorCount: 0,
      availabilityRatio: 1,
    });
    expect(mcpAvailability?.observations).toMatchObject({
      totalCount: 1,
      errorCount: 1,
      availabilityRatio: 0,
    });
    expect(hybridSearch?.observations).toMatchObject({
      sampleCount: 2,
      slowCount: 1,
      p95Ms: 2250,
    });
    expect(webhookAck?.observations).toMatchObject({
      sampleCount: 1,
      lateCount: 1,
    });
    expect(aclLeakage?.observations).toMatchObject({
      totalCount: 1,
      violationCount: 1,
      budgetRemainingCount: -1,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('family');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('content');
  });
});

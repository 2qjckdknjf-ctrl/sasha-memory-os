import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_CAPTURE_POLICY_PACK,
  OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION,
  applyCapturePreview,
  decideCaptureDisposition,
} from './capturePolicy.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M15.7 autonomous capture policy', () => {
  it('publishes policy pack without live E2E PASS from mocks', () => {
    expect(OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION).toBe('m15-s07-v1');
    expect(OFFICIAL_M15_CAPTURE_POLICY_PACK.invariants).toMatchObject({
      neverAutoPromoteSecrets: true,
      uncertainRequiresPreviewApply: true,
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('auto-promotes high-confidence safe classes and rejects secrets/chatter', () => {
    expect(
      decideCaptureDisposition({
        projectId,
        captureClass: 'meaningful_decision',
        confidence: 0.92,
      }).disposition,
    ).toBe('auto_promote');

    expect(
      decideCaptureDisposition({
        projectId,
        captureClass: 'secret_or_credential',
        confidence: 0.99,
      }).disposition,
    ).toBe('reject');

    expect(
      decideCaptureDisposition({
        projectId,
        captureClass: 'transient_chatter',
        confidence: 0.99,
      }).disposition,
    ).toBe('reject');

    expect(
      decideCaptureDisposition({
        projectId,
        captureClass: 'blocker',
        confidence: 0.5,
      }).disposition,
    ).toBe('preview_required');

    expect(
      decideCaptureDisposition({
        projectId,
        captureClass: 'low_confidence_guess',
        confidence: 0.4,
      }).disposition,
    ).toBe('preview_required');
  });

  it('honors per-source/project overrides and preview/apply gate', () => {
    const forced = decideCaptureDisposition({
      projectId,
      source: 'gmail',
      captureClass: 'important_fact',
      confidence: 0.95,
      override: {
        projectId,
        source: 'gmail',
        forcePreviewClasses: ['important_fact'],
      },
    });
    expect(forced.disposition).toBe('preview_required');

    expect(
      applyCapturePreview({
        projectId,
        decision: forced,
        approved: false,
        proposedTitle: 'fact',
      }).status,
    ).toBe('skipped');

    expect(
      applyCapturePreview({
        projectId,
        decision: forced,
        approved: true,
        proposedTitle: 'fact',
      }),
    ).toEqual({ status: 'applied', memoryTitle: 'fact' });

    expect(() =>
      decideCaptureDisposition({
        projectId: '  ',
        captureClass: 'blocker',
        confidence: 0.9,
      }),
    ).toThrow(/project_id is required/);
  });
});

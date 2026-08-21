export const OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION = 'm15-s07-v1' as const;

export type CaptureClass =
  | 'meaningful_decision'
  | 'project_milestone'
  | 'approved_spec'
  | 'blocker'
  | 'task_or_goal'
  | 'source_change'
  | 'important_fact'
  | 'transient_chatter'
  | 'secret_or_credential'
  | 'low_confidence_guess'
  | 'unnecessary_private';

export type CaptureDisposition =
  | 'auto_promote'
  | 'preview_required'
  | 'reject';

export type CapturePolicyDecision = {
  captureClass: CaptureClass;
  disposition: CaptureDisposition;
  reason: string;
  confidence: number;
};

export const DEFAULT_AUTO_PROMOTE_CLASSES: ReadonlySet<CaptureClass> = new Set([
  'meaningful_decision',
  'project_milestone',
  'approved_spec',
  'blocker',
  'task_or_goal',
  'source_change',
  'important_fact',
]);

export const DEFAULT_REJECT_CLASSES: ReadonlySet<CaptureClass> = new Set([
  'transient_chatter',
  'secret_or_credential',
  'unnecessary_private',
]);

export const OFFICIAL_M15_CAPTURE_POLICY_PACK = {
  version: OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION,
  roadmapSections: ['15.7', 'autonomous-capture-policy'],
  autoPromoteClasses: [...DEFAULT_AUTO_PROMOTE_CLASSES],
  rejectClasses: [...DEFAULT_REJECT_CLASSES],
  uncertainDisposition: 'preview_required' as const,
  highConfidenceAutoPromoteFloor: 0.85,
  invariants: {
    neverAutoPromoteSecrets: true,
    neverAutoPromoteTransientChatter: true,
    uncertainRequiresPreviewApply: true,
    perSourcePerProjectOverridesAllowed: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveE2EPassFromMocks: false,
  },
  liveE2E: {
    statusInThisSlice: 'policy_fixture_pass_live_blocked',
    note: 'Policy fixture PASS; live autonomous capture against production chats remains blocked / out of scope for this pack.',
  },
} as const;

export type CapturePolicyOverride = {
  projectId: string;
  source?: string;
  forcePreviewClasses?: CaptureClass[];
  forceRejectClasses?: CaptureClass[];
  autoPromoteFloor?: number;
};

export function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

export function decideCaptureDisposition(input: {
  projectId: string;
  captureClass: CaptureClass;
  confidence: number;
  source?: string;
  override?: CapturePolicyOverride;
}): CapturePolicyDecision {
  const projectId = requireExplicitProjectId(input.projectId);
  if (input.override && input.override.projectId !== projectId) {
    throw new Error('capture policy override project_id mismatch');
  }
  if (
    input.override?.source &&
    input.source &&
    input.override.source !== input.source
  ) {
    // Override for another source does not apply.
  }

  const overrideApplies =
    !!input.override &&
    input.override.projectId === projectId &&
    (!input.override.source || input.override.source === input.source);

  const forceReject = overrideApplies
    ? new Set(input.override?.forceRejectClasses ?? [])
    : new Set<CaptureClass>();
  const forcePreview = overrideApplies
    ? new Set(input.override?.forcePreviewClasses ?? [])
    : new Set<CaptureClass>();
  const floor =
    (overrideApplies ? input.override?.autoPromoteFloor : undefined) ??
    OFFICIAL_M15_CAPTURE_POLICY_PACK.highConfidenceAutoPromoteFloor;

  if (
    forceReject.has(input.captureClass) ||
    DEFAULT_REJECT_CLASSES.has(input.captureClass)
  ) {
    return {
      captureClass: input.captureClass,
      disposition: 'reject',
      confidence: input.confidence,
      reason:
        input.captureClass === 'secret_or_credential'
          ? 'secrets must never auto-promote'
          : 'class is rejected by capture policy',
    };
  }

  if (forcePreview.has(input.captureClass)) {
    return {
      captureClass: input.captureClass,
      disposition: 'preview_required',
      confidence: input.confidence,
      reason: 'per-source/project override requires preview/apply',
    };
  }

  if (
    DEFAULT_AUTO_PROMOTE_CLASSES.has(input.captureClass) &&
    input.confidence >= floor
  ) {
    return {
      captureClass: input.captureClass,
      disposition: 'auto_promote',
      confidence: input.confidence,
      reason: 'high-confidence safe class may auto-promote',
    };
  }

  if (DEFAULT_AUTO_PROMOTE_CLASSES.has(input.captureClass)) {
    return {
      captureClass: input.captureClass,
      disposition: 'preview_required',
      confidence: input.confidence,
      reason: 'safe class but below confidence floor — preview/apply required',
    };
  }

  // low_confidence_guess and any unknown-safe residual
  return {
    captureClass: input.captureClass,
    disposition: 'preview_required',
    confidence: input.confidence,
    reason: 'uncertain extraction requires preview/apply',
  };
}

export type CapturePreviewApplyResult =
  | { status: 'applied'; memoryTitle: string }
  | { status: 'rejected'; reason: string }
  | { status: 'skipped'; reason: string };

export function applyCapturePreview(input: {
  projectId: string;
  decision: CapturePolicyDecision;
  approved: boolean;
  proposedTitle: string;
}): CapturePreviewApplyResult {
  requireExplicitProjectId(input.projectId);
  if (input.decision.disposition === 'reject') {
    return { status: 'rejected', reason: input.decision.reason };
  }
  if (input.decision.disposition === 'auto_promote') {
    return { status: 'applied', memoryTitle: input.proposedTitle };
  }
  // preview_required
  if (!input.approved) {
    return { status: 'skipped', reason: 'preview not approved' };
  }
  return { status: 'applied', memoryTitle: input.proposedTitle };
}

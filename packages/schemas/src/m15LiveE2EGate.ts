export const OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION = 'm15-live-e2e-v1' as const;

export type LiveE2ECheckId =
  | 'chatgpt_cursor_github_drive_gmail_calendar_roma_scopes'
  | 'automatic_project_state_without_manual_save'
  | 'freshness_dashboard_objective_health'
  | 'connector_orchestration_live'
  | 'freshness_live_sources'
  | 'provider_revoke_live'
  | 'autonomous_capture_live'
  | 'observability_dashboard_live'
  | 'remote_m15_1_migration_apply';

export type LiveE2ECheckStatus = 'PASS' | 'BLOCKED' | 'NOT_RUN';

export type LiveE2ECheck = {
  id: LiveE2ECheckId;
  status: LiveE2ECheckStatus;
  reason: string;
};

export const M15_LIVE_E2E_CHECKS: readonly LiveE2ECheck[] = [
  {
    id: 'chatgpt_cursor_github_drive_gmail_calendar_roma_scopes',
    status: 'BLOCKED',
    reason:
      'Mode A ChatGPT path previously PASS; full multi-connector live scope matrix still blocked on live credentials for GitHub/Drive/Gmail/Calendar orchestration.',
  },
  {
    id: 'automatic_project_state_without_manual_save',
    status: 'BLOCKED',
    reason:
      'Ingest/route/canonicalize/capture packs exist; live automatic project-state maintenance against production accounts not proven.',
  },
  {
    id: 'freshness_dashboard_objective_health',
    status: 'BLOCKED',
    reason: 'Freshness watermark fixtures PASS; live freshness dashboard/source E2E blocked.',
  },
  {
    id: 'connector_orchestration_live',
    status: 'BLOCKED',
    reason: 'M15.2 fixture PASS; live connector orchestration E2E blocked on credentials.',
  },
  {
    id: 'freshness_live_sources',
    status: 'BLOCKED',
    reason: 'M15.5 fixture PASS; live source freshness E2E blocked on credentials.',
  },
  {
    id: 'provider_revoke_live',
    status: 'BLOCKED',
    reason: 'M15.6 fixture convergence PASS; live provider revoke E2E blocked on credentials.',
  },
  {
    id: 'autonomous_capture_live',
    status: 'BLOCKED',
    reason: 'M15.7 policy fixture PASS; live autonomous chat capture E2E blocked.',
  },
  {
    id: 'observability_dashboard_live',
    status: 'BLOCKED',
    reason: 'M15.8 metric catalog PASS; live production dashboard wiring blocked / ops follow-up.',
  },
  {
    id: 'remote_m15_1_migration_apply',
    status: 'BLOCKED',
    reason:
      'Migration 20260821100000_m15_slice_01_source_event_contract.sql checked in; remote apply on Supabase vpxblcxsvlylqyldiuwr still explicit ops step.',
  },
] as const;

export const OFFICIAL_M15_LIVE_E2E_GATE_PACK = {
  version: OFFICIAL_M15_LIVE_E2E_GATE_PACK_VERSION,
  roadmapSections: ['15-exit-gate', 'live-e2e-closure'],
  overallStatus: 'BLOCKED' as const,
  claimPassFromMocks: false,
  exitGateRule:
    'All M15 live integration tests pass OR unsupported external API / credential limitations are explicitly documented and routed to the next platform-specific milestone.',
  routedNextMilestone: 'M16.1-apple-capability-feasibility-matrix',
  checks: M15_LIVE_E2E_CHECKS,
  invariants: {
    neverClaimLiveE2EPassFromMocks: true,
    documentBlockersExplicitly: true,
    routeToNextMilestoneWhenBlocked: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
  },
} as const;

export function summarizeM15LiveE2EGate(checks: readonly LiveE2ECheck[] = M15_LIVE_E2E_CHECKS): {
  overallStatus: 'PASS' | 'BLOCKED';
  passCount: number;
  blockedCount: number;
  mayAdvanceWithDocumentedLimitations: boolean;
  routedNextMilestone: string;
} {
  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const blockedCount = checks.filter((c) => c.status === 'BLOCKED').length;
  const allPass = blockedCount === 0 && checks.every((c) => c.status === 'PASS');
  return {
    overallStatus: allPass ? 'PASS' : 'BLOCKED',
    passCount,
    blockedCount,
    mayAdvanceWithDocumentedLimitations:
      !allPass &&
      blockedCount > 0 &&
      checks.every((c) => c.status === 'PASS' || c.status === 'BLOCKED'),
    routedNextMilestone: OFFICIAL_M15_LIVE_E2E_GATE_PACK.routedNextMilestone,
  };
}

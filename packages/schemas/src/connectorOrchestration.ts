import { z } from 'zod';

export const OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION = 'm15-s02-v1' as const;

export const connectorOrchestrationRecoveryScenarioSchema = z.enum([
  'connector_restart',
  'duplicate_event',
  'missed_webhook',
  'token_expiry',
]);

export type ConnectorOrchestrationRecoveryScenario = z.infer<
  typeof connectorOrchestrationRecoveryScenarioSchema
>;

export const OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK = {
  version: OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION,
  roadmapSections: ['15.2', 'continuous-connector-orchestration'],
  schedulerOwnership: {
    edgeEnqueue: 'supabase/functions/worker-ticks + .github/workflows/worker-ticks.yml',
    nodeExecute: 'workers/connector-sync + .github/workflows/node-workers.yml',
    recoveryOrder: [
      'dead_letter_stale',
      'enqueue_due',
      'claim_and_execute',
      'retry_or_dead_letter',
      'bounded_repair_hooks',
    ] as const,
  },
  recoveryScenarios: [
    'connector_restart',
    'duplicate_event',
    'missed_webhook',
    'token_expiry',
  ] as const,
  liveE2E: {
    requiredForExitGate: true,
    statusInThisSlice: 'blocked_missing_live_credentials',
    note:
      'Fixture/unit proofs only in m15-s02-v1. Live GitHub/Drive/Gmail/Calendar orchestration E2E remains an explicit blocker until credentials + remote migration apply are exercised.',
  },
  invariants: {
    reuseExistingDlqReplayResync: true,
    noSilentDataLossOnRecovery: true,
    writesRequireExplicitProjectId: true,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    modeAToolCount: 7,
    claimLiveE2EPassFromMocks: false,
  },
} as const;

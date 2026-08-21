import {
  OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK,
  type ConnectorOrchestrationRecoveryScenario,
} from '@memory-os/schemas';

export type OrchestrationRepairHookResult = {
  scenario: ConnectorOrchestrationRecoveryScenario;
  recovered: boolean;
  silentDataLoss: boolean;
  detail: string;
};

export type ConnectorOrchestrationTickResult = {
  packVersion: string;
  recoveryOrder: readonly string[];
  steps: string[];
  repairs: OrchestrationRepairHookResult[];
  liveE2EClaimed: false;
};

/**
 * Bounded orchestration tick planner for M15.2.
 * Proves recovery ordering and repair-hook contracts without claiming live E2E.
 */
export async function planConnectorOrchestrationTick(input?: {
  runDeadLetterStale?: () => Promise<void> | void;
  runEnqueueDue?: () => Promise<void> | void;
  runClaimAndExecute?: () => Promise<void> | void;
  runRetryOrDeadLetter?: () => Promise<void> | void;
  repairHooks?: Partial<
    Record<
      ConnectorOrchestrationRecoveryScenario,
      () => Promise<OrchestrationRepairHookResult> | OrchestrationRepairHookResult
    >
  >;
}): Promise<ConnectorOrchestrationTickResult> {
  const steps: string[] = [];
  const order = OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.schedulerOwnership.recoveryOrder;

  for (const step of order) {
    steps.push(step);
    if (step === 'dead_letter_stale') await input?.runDeadLetterStale?.();
    if (step === 'enqueue_due') await input?.runEnqueueDue?.();
    if (step === 'claim_and_execute') await input?.runClaimAndExecute?.();
    if (step === 'retry_or_dead_letter') await input?.runRetryOrDeadLetter?.();
    if (step === 'bounded_repair_hooks') {
      // executed below after core loop
    }
  }

  const repairs: OrchestrationRepairHookResult[] = [];
  for (const scenario of OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.recoveryScenarios) {
    const hook = input?.repairHooks?.[scenario];
    if (!hook) {
      repairs.push({
        scenario,
        recovered: false,
        silentDataLoss: false,
        detail: 'repair hook not provided in this tick',
      });
      continue;
    }
    const result = await hook();
    if (result.silentDataLoss) {
      throw new Error(
        `orchestration repair for ${scenario} reported silent data loss — fail closed`,
      );
    }
    repairs.push(result);
  }

  return {
    packVersion: OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK.version,
    recoveryOrder: order,
    steps,
    repairs,
    liveE2EClaimed: false,
  };
}

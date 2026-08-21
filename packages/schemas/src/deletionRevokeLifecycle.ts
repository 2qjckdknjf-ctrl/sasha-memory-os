import type { SourceEventChangeState } from './sourceEvent.js';

export const OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION = 'm15-s06-v1' as const;

export type LifecycleActionKind =
  | 'upsert_canonical'
  | 'tombstone_object'
  | 'stop_sync_immediately'
  | 'expire_derived_memories'
  | 'preserve_audit_metadata'
  | 'reconnect_without_duplication'
  | 'noop';

export type LifecycleAction = {
  kind: LifecycleActionKind;
  projectId: string;
  reason: string;
  externalId?: string;
  connectionId?: string;
};

export const OFFICIAL_M15_DELETION_REVOKE_PACK = {
  version: OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION,
  roadmapSections: ['15.6', 'deletion-revoke-lifecycle'],
  surfaces: {
    sourceEventChangeStates: ['delete', 'revoke'] as const,
    connectionRevokeRoute: 'POST /v1/connections/:id/revoke',
    privacyDeletionRoute: 'POST /v1/privacy/requests',
    sharedTombstoneWorker: 'workers/connector-sync',
  },
  invariants: {
    tombstoneOnSourceDelete: true,
    stopSyncOnConnectionRevoke: true,
    expireDerivedOnRevokeWhenPolicyRequires: true,
    preserveAllowedAuditMetadata: true,
    reconnectWithoutUncontrolledDuplication: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveE2EPassFromMocks: false,
  },
  liveE2E: {
    statusInThisSlice: 'fixture_convergence_pass_live_blocked',
    note: 'Fixture deletion/revoke convergence PASS with privacy tests; live provider revoke E2E remains blocked without credentials.',
  },
} as const;

export function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

/**
 * Map an ingested source-event change_state into lifecycle actions.
 * delete → tombstone the object; revoke → stop future sync + tombstone + expire derived.
 */
export function planSourceLifecycleActions(input: {
  projectId: string;
  changeState: SourceEventChangeState;
  externalId?: string | null;
  expireDerivedOnRevoke?: boolean;
}): LifecycleAction[] {
  const projectId = requireExplicitProjectId(input.projectId);
  const externalId = input.externalId?.trim() || undefined;

  switch (input.changeState) {
    case 'upsert':
      return [
        {
          kind: 'upsert_canonical',
          projectId,
          externalId,
          reason: 'source upsert converges into canonical projection',
        },
      ];
    case 'delete':
      return [
        {
          kind: 'tombstone_object',
          projectId,
          externalId,
          reason: 'source delete requires object tombstone out of active retrieval',
        },
        {
          kind: 'preserve_audit_metadata',
          projectId,
          externalId,
          reason: 'allowed audit metadata retained per retention policy',
        },
      ];
    case 'revoke': {
      const actions: LifecycleAction[] = [
        {
          kind: 'stop_sync_immediately',
          projectId,
          externalId,
          reason: 'permission revoke must halt future sync for the object/account',
        },
        {
          kind: 'tombstone_object',
          projectId,
          externalId,
          reason: 'revoked source object leaves active retrieval',
        },
        {
          kind: 'preserve_audit_metadata',
          projectId,
          externalId,
          reason: 'allowed audit metadata retained per retention policy',
        },
      ];
      if (input.expireDerivedOnRevoke !== false) {
        actions.splice(2, 0, {
          kind: 'expire_derived_memories',
          projectId,
          externalId,
          reason: 'derived memories expire when revoke policy requires removal',
        });
      }
      return actions;
    }
    default: {
      const _exhaustive: never = input.changeState;
      void _exhaustive;
      return [{ kind: 'noop', projectId, reason: 'unknown change_state' }];
    }
  }
}

export function planConnectionRevoke(input: {
  projectId: string;
  connectionId: string;
}): LifecycleAction[] {
  const projectId = requireExplicitProjectId(input.projectId);
  const connectionId = input.connectionId.trim();
  if (!connectionId) {
    throw new Error('connection_id is required');
  }
  return [
    {
      kind: 'stop_sync_immediately',
      projectId,
      connectionId,
      reason: 'connection revoke stops jobs/webhooks immediately',
    },
    {
      kind: 'tombstone_object',
      projectId,
      connectionId,
      reason: 'connector-derived active objects hand off to shared tombstone path',
    },
    {
      kind: 'expire_derived_memories',
      projectId,
      connectionId,
      reason: 'privacy/retention may expire derived memories while keeping audit metadata',
    },
    {
      kind: 'preserve_audit_metadata',
      projectId,
      connectionId,
      reason: 'audit metadata preserved (no bodies/tokens)',
    },
  ];
}

/**
 * Reconnect/regrant must reuse provenance keys so a second grant does not
 * create uncontrolled duplicate canonical rows.
 */
export function planReconnect(input: {
  projectId: string;
  connectionId: string;
  priorProvenanceKey: string;
  newProvenanceKey: string;
}): LifecycleAction[] {
  const projectId = requireExplicitProjectId(input.projectId);
  if (input.priorProvenanceKey !== input.newProvenanceKey) {
    throw new Error(
      'reconnect provenance key mismatch would risk uncontrolled duplication',
    );
  }
  return [
    {
      kind: 'reconnect_without_duplication',
      projectId,
      connectionId: input.connectionId,
      reason: 'same provenance key reattaches without inventing a second canonical row',
    },
  ];
}

export type LifecycleSimulationState = {
  activeExternalIds: Set<string>;
  stoppedConnections: Set<string>;
  expiredDerivedExternalIds: Set<string>;
  auditKeys: Set<string>;
  canonicalByProvenance: Map<string, string>;
};

export function createLifecycleSimulationState(): LifecycleSimulationState {
  return {
    activeExternalIds: new Set(),
    stoppedConnections: new Set(),
    expiredDerivedExternalIds: new Set(),
    auditKeys: new Set(),
    canonicalByProvenance: new Map(),
  };
}

/** Fixture end-to-end convergence applicator (not a live provider client). */
export function applyLifecycleActions(
  state: LifecycleSimulationState,
  actions: LifecycleAction[],
  opts?: { provenanceKey?: string; canonicalId?: string },
): LifecycleSimulationState {
  for (const action of actions) {
    switch (action.kind) {
      case 'upsert_canonical': {
        if (action.externalId) state.activeExternalIds.add(action.externalId);
        if (opts?.provenanceKey && opts.canonicalId) {
          state.canonicalByProvenance.set(opts.provenanceKey, opts.canonicalId);
        }
        break;
      }
      case 'tombstone_object': {
        if (action.externalId) state.activeExternalIds.delete(action.externalId);
        break;
      }
      case 'stop_sync_immediately': {
        if (action.connectionId) state.stoppedConnections.add(action.connectionId);
        break;
      }
      case 'expire_derived_memories': {
        if (action.externalId) {
          state.expiredDerivedExternalIds.add(action.externalId);
          state.activeExternalIds.delete(action.externalId);
        }
        break;
      }
      case 'preserve_audit_metadata': {
        const key = action.externalId ?? action.connectionId ?? 'project';
        state.auditKeys.add(`${action.projectId}:${key}`);
        break;
      }
      case 'reconnect_without_duplication': {
        // no-op on sets; provenance map already holds single canonical id
        break;
      }
      case 'noop':
        break;
      default: {
        const _exhaustive: never = action.kind;
        void _exhaustive;
        break;
      }
    }
  }
  return state;
}

export function measureDeletionRevokeConvergence(input: {
  initiallyActive: string[];
  afterActionsActive: Iterable<string>;
  mustBeGone: string[];
}): { converged: boolean; remainingUnexpected: string[] } {
  const after = new Set(input.afterActionsActive);
  const remainingUnexpected = input.mustBeGone.filter((id) => after.has(id));
  return {
    converged: remainingUnexpected.length === 0,
    remainingUnexpected,
  };
}

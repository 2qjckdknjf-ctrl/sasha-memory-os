import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_DELETION_REVOKE_PACK,
  OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION,
  applyLifecycleActions,
  createLifecycleSimulationState,
  measureDeletionRevokeConvergence,
  planConnectionRevoke,
  planReconnect,
  planSourceLifecycleActions,
  requireExplicitProjectId,
} from './deletionRevokeLifecycle.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M15.6 deletion/revoke lifecycle pack', () => {
  it('publishes pack without claiming live E2E PASS from mocks', () => {
    expect(OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION).toBe('m15-s06-v1');
    expect(OFFICIAL_M15_DELETION_REVOKE_PACK.invariants).toMatchObject({
      tombstoneOnSourceDelete: true,
      stopSyncOnConnectionRevoke: true,
      reconnectWithoutUncontrolledDuplication: true,
      claimLiveE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('fail-closes when project_id is missing', () => {
    expect(() => requireExplicitProjectId(undefined)).toThrow(/project_id is required/);
    expect(() =>
      planSourceLifecycleActions({
        projectId: '  ',
        changeState: 'delete',
      }),
    ).toThrow(/project_id is required/);
  });

  it('plans tombstone + audit for delete and stop+expire for revoke', () => {
    const del = planSourceLifecycleActions({
      projectId,
      changeState: 'delete',
      externalId: 'file-1',
    });
    expect(del.map((a) => a.kind)).toEqual([
      'tombstone_object',
      'preserve_audit_metadata',
    ]);

    const rev = planSourceLifecycleActions({
      projectId,
      changeState: 'revoke',
      externalId: 'file-2',
    });
    expect(rev.map((a) => a.kind)).toEqual([
      'stop_sync_immediately',
      'tombstone_object',
      'expire_derived_memories',
      'preserve_audit_metadata',
    ]);
  });

  it('proves fixture end-to-end deletion/revoke convergence with privacy retention', () => {
    const state = createLifecycleSimulationState();
    applyLifecycleActions(
      state,
      planSourceLifecycleActions({
        projectId,
        changeState: 'upsert',
        externalId: 'drive:abc',
      }),
      { provenanceKey: 'drive:abc@v1', canonicalId: 'mem-1' },
    );
    expect(state.activeExternalIds.has('drive:abc')).toBe(true);

    applyLifecycleActions(
      state,
      planSourceLifecycleActions({
        projectId,
        changeState: 'delete',
        externalId: 'drive:abc',
      }),
    );
    const deleted = measureDeletionRevokeConvergence({
      initiallyActive: ['drive:abc'],
      afterActionsActive: state.activeExternalIds,
      mustBeGone: ['drive:abc'],
    });
    expect(deleted.converged).toBe(true);
    expect(state.auditKeys.has(`${projectId}:drive:abc`)).toBe(true);

    applyLifecycleActions(
      state,
      planSourceLifecycleActions({
        projectId,
        changeState: 'upsert',
        externalId: 'mail:xyz',
      }),
    );
    applyLifecycleActions(
      state,
      planConnectionRevoke({ projectId, connectionId: 'conn-gmail-1' }),
    );
    expect(state.stoppedConnections.has('conn-gmail-1')).toBe(true);

    applyLifecycleActions(
      state,
      planSourceLifecycleActions({
        projectId,
        changeState: 'revoke',
        externalId: 'mail:xyz',
      }),
    );
    expect(state.expiredDerivedExternalIds.has('mail:xyz')).toBe(true);
    expect(state.activeExternalIds.has('mail:xyz')).toBe(false);

    const reconnect = planReconnect({
      projectId,
      connectionId: 'conn-drive-1',
      priorProvenanceKey: 'drive:abc@v1',
      newProvenanceKey: 'drive:abc@v1',
    });
    applyLifecycleActions(state, reconnect);
    expect(state.canonicalByProvenance.get('drive:abc@v1')).toBe('mem-1');
    expect(() =>
      planReconnect({
        projectId,
        connectionId: 'conn-drive-1',
        priorProvenanceKey: 'drive:abc@v1',
        newProvenanceKey: 'drive:abc@v2-bad',
      }),
    ).toThrow(/uncontrolled duplication/);
  });
});

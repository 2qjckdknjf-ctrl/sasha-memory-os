import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createPrivacyRequestSchema,
  OFFICIAL_M20_PRIVACY_COMPLIANCE_GATE_PACK,
  sanitizePrivacyOperationalFields,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const repoFile = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

const baseRequest = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  project_id: '44444444-4444-4444-8444-444444444402',
  actor_subject_id: '33333333-3333-4333-8333-333333333301',
  reason: 'owner request',
  idempotency_key: 'm20-s04/unit',
};

describe('M20.4 privacy and compliance gate', () => {
  it('freezes owner, erasure, retention, telemetry, and seven-tool invariants', () => {
    expect(OFFICIAL_M20_PRIVACY_COMPLIANCE_GATE_PACK).toMatchObject({
      version: 'm20-s04-v1',
      retentionDays: {
        candidateMemories: 90,
        quarantineArtifacts: 180,
        publishedOutbox: 30,
        deadLetters: 90,
        audit: 365,
      },
      invariants: {
        ownerOnly: true,
        explicitProjectRequired: true,
        derivedMemoriesIncluded: true,
        typedMemoryPayloadsExported: true,
        recursiveDerivedErasure: true,
        sharedSourceConsumersErasedWorkspaceWide: true,
        notificationAndOutboxDerivativesRedacted: true,
        connectorOutboxPayloadsRedacted: true,
        unaffectedGraphLinksPreserved: true,
        derivationMetadataIsAllowlisted: true,
        sourceRevocationDeletesVaultReferences: true,
        graphProjectionRemovedOnDeletion: true,
        exportIncludesRevisionHistory: true,
        routedMemoryProvenanceIncluded: true,
        exportIsFullyPaginated: true,
        exportUsesStableSnapshot: true,
        exportUsesMaterializedSnapshot: true,
        exportSnapshotItemsAreRowBounded: true,
        exportSnapshotsAreOwnerBoundAndEphemeral: true,
        exportSnapshotsHaveIndependentScheduledPurge: true,
        erasureInvalidatesExportSnapshots: true,
        exportAndErasureAreWorkspaceSerialized: true,
        connectorRevocationIsWorkspaceWide: true,
        legacyConnectorIdentityResolved: true,
        connectorCaptureJobsStopped: true,
        correctionPreservesEffectiveProject: true,
        legacyRequestsFailClosed: true,
        requestCreationIsConcurrentlyIdempotent: true,
        futureRetentionCutoffsRejected: true,
        retentionLocksCandidatesBeforeMutation: true,
        routingCorrectionsSerializeWithRetention: true,
        retentionLocksArtifactsBeforeMutation: true,
        retentionLocksJobsAndOutboxBeforeMutation: true,
        retentionLocksSourceJobsBeforeMutation: true,
        retentionRescansSourceConsumers: true,
        retentionPreviewIncludesSourceConsumers: true,
        retentionSkipsCrossProjectSharedSources: true,
        retentionRedactsAsyncDerivatives: true,
        retentionExpiresSuccessfulJobOutbox: true,
        retentionOnlyExpiresQuarantinedArtifacts: true,
        retentionRedactsSharedEntities: true,
        retentionIsProjectScoped: true,
        failedExecutionIsAtomicAndDurable: true,
        auditContainsMetadataOnly: true,
        logsContainSensitiveBodies: false,
        modeAToolCount: 7,
      },
    });
  });

  it('rejects incomplete request targets before execution', () => {
    expect(
      createPrivacyRequestSchema.safeParse({
        ...baseRequest,
        request_type: 'deletion',
      }).success,
    ).toBe(false);
    expect(
      createPrivacyRequestSchema.safeParse({
        ...baseRequest,
        request_type: 'correction',
        target_memory_id: '99999999-0000-4000-8000-000000000401',
      }).success,
    ).toBe(false);
    expect(
      createPrivacyRequestSchema.safeParse({
        ...baseRequest,
        request_type: 'deletion',
        target_connector_account_id: '99999999-0000-4000-8000-000000000410',
      }).success,
    ).toBe(true);
  });

  it('allowlists operational fields and drops content, reasons, payloads, and tokens', () => {
    expect(
      sanitizePrivacyOperationalFields({
        requestId: 'request-1',
        affectedMemoryCount: 2,
        sourceRevoked: true,
        content: 'secret-memory-body',
        payload: { text: 'secret-source-body' },
        reason: 'secret owner reason',
        correctionText: 'secret correction',
        accessToken: 'token',
      }),
    ).toEqual({
      requestId: 'request-1',
      affectedMemoryCount: 2,
      sourceRevoked: true,
    });
  });

  it('wires the migration, API, UI, SQL acceptance, DPIA, and current state', () => {
    const migration = repoFile(
      'supabase/migrations/20261015230000_m20_privacy_compliance_operations.sql',
    );
    const api = repoFile('apps/api/src/app.ts');
    const privacyUi = repoFile('apps/web/src/PrivacyPage.tsx');
    const appUi = repoFile('apps/web/src/App.tsx');
    const sql = repoFile('tests/security/m20_privacy_compliance_cases.sql');
    const ephemeral = repoFile('scripts/ci-ephemeral-shared-memory-smoke.sh');
    const dataMap = repoFile('docs/m0/DATA_CLASSES_AND_RETENTION.md');
    const dpia = repoFile('docs/m0/THREAT_MODEL_DPIA.md');
    const docs = repoFile('docs/engineering/M20_SLICE_04_PRIVACY_COMPLIANCE.md');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(migration).toContain('api_export_project_privacy_bundle');
    expect(migration).toContain('api_execute_privacy_request');
    expect(migration).toContain('api_apply_retention_policy');
    expect(migration).toContain('ON CONFLICT (workspace_id, idempotency_key) DO NOTHING');
    expect(migration).toContain('trg_guard_project_routing_correction_mutation');
    expect(migration).toContain("failure_code = 'execution_failed_' || lower(v_failure_sqlstate)");
    expect(migration).toContain("'nextOffset'");
    expect(migration).toContain("'snapshotAt'");
    expect(migration).toContain("'exportId'");
    expect(migration).toContain('privacy_export_snapshots');
    expect(migration).toContain('privacy_export_snapshot_items');
    expect(migration).toContain('purge_expired_privacy_export_snapshots');
    expect(migration).toContain('memory-os-privacy-export-snapshot-purge');
    expect(migration).toContain("'revisions'");
    expect(migration).toContain('FROM public.memory_revisions mr');
    expect(migration).toContain('FOR UPDATE OF workspace');
    expect(migration).toContain('source_event_in_project_export_at');
    expect(migration).toContain('as_of must not be null or in the future');
    expect(migration).toContain('FOR UPDATE OF m');
    expect(migration).toContain('FOR UPDATE OF a');
    expect(migration).toContain('FOR UPDATE OF j');
    expect(migration).toContain('FOR UPDATE OF o');
    expect(migration).toContain('broken legacy worker left the artifact quarantined');
    expect(migration).toContain("s.payload #>> '{source,account_id}'");
    expect(migration).toContain('j.source_event_id = ANY(v_source_ids)');
    expect(migration).toContain(`a.metadata @> '{"quarantine": true}'::jsonb`);
    expect(migration).toContain("canonical_name = 'Redacted retained entity'");
    expect(migration).toContain('v_offset integer');
    expect(migration).toContain("reason = '[redacted after execution]'");
    expect(migration).toContain("reason = 'privacy correction redacted'");
    expect(migration).toContain('v_previous_affected_count');
    expect(migration).toContain("m.metadata->>'derivedFromMemoryId'");
    expect(migration).not.toContain('m.metadata::text LIKE');
    expect(migration).toContain("'decision'");
    expect(migration).toContain("'task'");
    expect(migration).toContain('DELETE FROM public.artifact_chunks');
    expect(migration).toContain('embedding_vector_hq = NULL');
    expect(migration).toContain('DELETE FROM public.entity_edges');
    expect(migration).toContain('PERFORM app.api_vault_kms_delete');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(api).toContain("app.get('/v1/export/privacy'");
    expect(api).toContain("app.post('/v1/privacy/requests/:id/execute'");
    expect(api).toContain("app.post('/v1/privacy/retention/run'");
    expect(appUi).toContain('/v1/export/privacy?workspace_id=');
    expect(appUi).toContain('Privacy export pagination did not advance');
    expect(privacyUi).toContain('executeRequest(request)');
    expect(privacyUi).toContain('runRetention(false)');
    expect(privacyUi).not.toContain('{request.reason}');
    expect(privacyUi).not.toContain('{request.correctionText}');
    expect(sql).toContain('m20_privacy_compliance_cases=pass');
    expect(sql).toContain('derived deletion did not complete');
    expect(sql).toContain('sensitive content leaked into operational audit state');
    expect(sql).toContain('cross-project memory were not revoked');
    expect(sql).toContain("o.payload->>'privacyRedacted' = 'true'");
    expect(sql).toContain('privacy correction lost effective project routing');
    expect(sql).toContain('Legacy api_capture_connector_record rows');
    expect(sql).toContain("a.metadata @> '{\"quarantine\": false}'::jsonb");
    expect(sql).toContain('legacy request without a target unexpectedly executed');
    expect(sql).toContain('crossed the project boundary');
    expect(sql).toContain('mutated after export snapshot');
    expect(sql).toContain('future retention cutoff mutated data');
    expect(sql).toContain('expired export snapshot purge is not independently scheduled');
    expect(sql).toContain('workspace provenance consumer retained content/embedding');
    expect(sql).toContain('pre-erasure export snapshot readable');
    expect(sql).toContain('Out-of-project shared retention consumer');
    expect(sql).toContain('notification, outbox, or job retained erased memory data');
    expect(sql).toContain('Retention-redacted notification');
    expect(sql).toContain("'ingest.succeeded'");
    expect(sql).toContain('privacy execution failure was not atomic and durable');
    expect(ephemeral).toContain('m20_privacy_compliance_cases.sql');
    expect(dataMap).toContain('POST /v1/privacy/retention/run');
    expect(dpia).toContain('V1 GA technical review refreshed 2026-10-15');
    expect(docs).toContain('production acceptance is required after merge');
    expect(current.officialPacks.m20PrivacyCompliance).toBe('m20-s04-v1');
    expect(current.supabase.latestMigration).toBe(
      '20261015230000_m20_privacy_compliance_operations.sql',
    );
    expect(current.tests.m20PrivacyComplianceSql).toBe(
      'tests/security/m20_privacy_compliance_cases.sql',
    );
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819161434_m8_slice_03_projects_chats_ingest.sql', import.meta.url),
);
const aclScopeMigrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819172929_m8_slice_03_acl_scope_and_project_list.sql', import.meta.url),
);
const projectRefFixMigrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819224721_fix_project_ref_uuid_aggregate.sql', import.meta.url),
);
const replayResyncFixMigrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819224917_fix_replay_resync_claimability.sql', import.meta.url),
);
const romaProjectHealthMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820014948_m12_slice_01_roma_project_health_job.sql',
    import.meta.url,
  ),
);
const romaQaFindingsMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820022425_m12_slice_03_roma_qa_findings.sql',
    import.meta.url,
  ),
);
const romaNotificationsMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820024500_m12_slice_04_roma_notifications.sql',
    import.meta.url,
  ),
);
const romaApprovalCheckpointsMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820031500_m12_slice_05_roma_approval_checkpoints.sql',
    import.meta.url,
  ),
);
const romaActionBudgetsMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820033000_m12_slice_06_roma_action_budgets.sql',
    import.meta.url,
  ),
);
const proactiveConsolidationMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820034500_m13_slice_03_proactive_consolidation.sql',
    import.meta.url,
  ),
);
const contradictionDetectionMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820043913_m13_slice_04_advanced_contradiction_detection.sql',
    import.meta.url,
  ),
);
const personalizedImportanceMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820050100_m13_slice_05_personalized_importance.sql',
    import.meta.url,
  ),
);
const privacySlaGuardsMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260820065500_m14_slice_06_privacy_request_sla_guards.sql',
    import.meta.url,
  ),
);
const p0ProjectIdentityMigrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260824100000_p0_project_identity_scope.sql',
    import.meta.url,
  ),
);

describe('m8 slice 03 migration guards', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const aclScopeSql = readFileSync(aclScopeMigrationPath, 'utf8');
  const projectRefFixSql = readFileSync(projectRefFixMigrationPath, 'utf8');
  const replayResyncFixSql = readFileSync(replayResyncFixMigrationPath, 'utf8');
  const romaProjectHealthSql = readFileSync(romaProjectHealthMigrationPath, 'utf8');
  const romaQaFindingsSql = readFileSync(romaQaFindingsMigrationPath, 'utf8');
  const romaNotificationsSql = readFileSync(romaNotificationsMigrationPath, 'utf8');
  const romaApprovalCheckpointsSql = readFileSync(
    romaApprovalCheckpointsMigrationPath,
    'utf8',
  );
  const romaActionBudgetsSql = readFileSync(romaActionBudgetsMigrationPath, 'utf8');
  const proactiveConsolidationSql = readFileSync(
    proactiveConsolidationMigrationPath,
    'utf8',
  );
  const contradictionDetectionSql = readFileSync(
    contradictionDetectionMigrationPath,
    'utf8',
  );
  const personalizedImportanceSql = readFileSync(
    personalizedImportanceMigrationPath,
    'utf8',
  );
  const privacySlaGuardsSql = readFileSync(privacySlaGuardsMigrationPath, 'utf8');

  it('matches connector projects only by unique repository identity', () => {
    expect(sql).toContain(`repo->>'url' = v_repo_url`);
    expect(sql).toContain(`repo->>'external_id' = v_external_id`);
    expect(sql).toContain(`repo->>'collection_id' = p_collection_id`);
    expect(sql).not.toContain(`lower(p.slug) IN (v_owner_hint, v_repo_hint, v_name_hint)`);
    expect(sql).not.toContain(`lower(p.name) IN (lower(v_display_name), lower(coalesce(p_collection_id, '')))`);
    expect(sql).not.toContain(`lower(v_owner_hint)`);
    expect(sql).not.toContain(`lower(v_repo_hint)`);
  });

  it('does not grant wildcard project access through null ACL rows', () => {
    expect(sql).not.toContain(`project_id, NULL`);
    expect(sql).not.toContain(`a.project_id IS NULL`);
  });

  it('limits connector project grants to ChatGPT/Cursor and keeps ROMA out', () => {
    expect(sql).toContain(`s.external_key IN ('chatgpt', 'cursor')`);
    expect(sql).not.toContain(`'roma'`);
    expect(sql).toContain(`'handoff'`);
  });

  it('overrides ACL matching so workspace scope does not match concrete projects', () => {
    expect(aclScopeSql).toContain(`WHEN p_requested_project_id IS NULL THEN p_acl_project_id IS NULL`);
    expect(aclScopeSql).toContain(`ELSE p_acl_project_id = p_requested_project_id`);
    expect(aclScopeSql).not.toContain(`unnest(coalesce(p.aliases`);
  });

  it('fixes project ref single-match resolution without invalid uuid aggregates', () => {
    expect(projectRefFixSql).toContain(`(array_agg(id ORDER BY name, slug))[1]::text`);
    expect(projectRefFixSql).not.toContain(`min(id)::text`);
  });

  it('clears connector cursors without a nonexistent workspace_id column and restores replayed accounts to connected', () => {
    expect(replayResyncFixSql).toContain(`DELETE FROM connector_cursors`);
    expect(replayResyncFixSql).toContain(`WHERE account_id = v_connection_id`);
    expect(replayResyncFixSql).toContain(`WHERE account_id = p_connection_id`);
    expect(replayResyncFixSql).not.toContain(`connector_cursors\n  WHERE workspace_id =`);
    expect(replayResyncFixSql).toContain(`RAISE EXCEPTION 'connection is not eligible for replay'`);
    expect(replayResyncFixSql).toContain(`ELSE 'connected'`);
    expect(replayResyncFixSql).toContain(`last_error = NULL`);
  });

  it('adds a dedicated ROMA project-health job with explicit project scope', () => {
    expect(romaProjectHealthSql).toContain(`'roma_project_health'`);
    expect(romaProjectHealthSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(romaProjectHealthSql).toContain(`'roma.project_health.requested'`);
    expect(romaProjectHealthSql).toContain(`'roma.project_health.completed'`);
    expect(romaProjectHealthSql).toContain(`SET published_at = coalesce(published_at, now())`);
    expect(romaProjectHealthSql).toContain(`AND event_type = 'roma.project_health.requested'`);
    expect(romaProjectHealthSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
  });

  it('forces claim and completion through the ROMA subject instead of owner identity', () => {
    expect(romaProjectHealthSql).toContain(
      `v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304'`,
    );
    expect(romaProjectHealthSql).toContain(`RAISE EXCEPTION 'roma subject required'`);
    expect(romaProjectHealthSql).toContain(`'executionSubjectId', v_roma_subject`);
  });

  it('adds a bounded retry path instead of consuming the request on first failure', () => {
    expect(romaProjectHealthSql).toContain(`CREATE OR REPLACE FUNCTION app.api_retry_roma_project_health`);
    expect(romaProjectHealthSql).toContain(`status = 'queued'`);
    expect(romaProjectHealthSql).toContain(`attempt = attempt + 1`);
    expect(romaProjectHealthSql).toContain(`last_error = v_error`);
  });

  it('adds a dedicated ROMA QA findings job with explicit project scope', () => {
    expect(romaQaFindingsSql).toContain(`'roma_project_findings'`);
    expect(romaQaFindingsSql).toContain(`app.assert_roma_project_health_schedule_access`);
    expect(romaQaFindingsSql).toContain(`'roma.project_findings.requested'`);
    expect(romaQaFindingsSql).toContain(`'roma.project_findings.completed'`);
    expect(romaQaFindingsSql).toContain(`'Generate audited ROMA QA findings for one explicit project.'`);
    expect(romaQaFindingsSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
  });

  it('forces findings claim and completion through the ROMA subject and records bounded retry state', () => {
    expect(romaQaFindingsSql).toContain(
      `v_roma_subject constant uuid := '33333333-3333-4333-8333-333333333304'`,
    );
    expect(romaQaFindingsSql).toContain(`RAISE EXCEPTION 'roma subject required'`);
    expect(romaQaFindingsSql).toContain(`CREATE OR REPLACE FUNCTION app.api_retry_roma_project_findings`);
    expect(romaQaFindingsSql).toContain(`attempt = attempt + 1`);
    expect(romaQaFindingsSql).toContain(`'executionSubjectId', v_roma_subject`);
  });

  it('adds durable audited project notifications with per-recipient idempotency', () => {
    expect(romaNotificationsSql).toContain(`CREATE TABLE project_notifications`);
    expect(romaNotificationsSql).toContain(`UNIQUE (workspace_id, recipient_subject_id, idempotency_key)`);
    expect(romaNotificationsSql).toContain(`'project.notification.created'`);
    expect(romaNotificationsSql).toContain(`created_by_subject = '33333333-3333-4333-8333-333333333304'::uuid`);
    expect(romaNotificationsSql).toContain(`notificationInsertedCount`);
  });

  it('creates notifications only on succeeded ROMA completion and reuses the existing ACL helper', () => {
    expect(romaNotificationsSql).toContain(`IF v_status = 'succeeded' AND v_project_id IS NOT NULL THEN`);
    expect(romaNotificationsSql).toContain(
      `PERFORM app.assert_roma_project_health_schedule_access(v_job.workspace_id, v_project_id);`,
    );
    expect(romaNotificationsSql).toContain(`'roma_project_health_completed'`);
    expect(romaNotificationsSql).toContain(`'roma_project_findings_completed'`);
    expect(romaNotificationsSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
  });

  it('adds additive approval checkpoints that stay project-scoped and ROMA-executed', () => {
    expect(romaApprovalCheckpointsSql).toContain(`CREATE TABLE approval_checkpoints`);
    expect(romaApprovalCheckpointsSql).toContain(`'roma_qa_finding_write'`);
    expect(romaApprovalCheckpointsSql).toContain(`execution_subject_id = '33333333-3333-4333-8333-333333333304'::uuid`);
    expect(romaApprovalCheckpointsSql).toContain(`UNIQUE (workspace_id, checkpoint_type, idempotency_key)`);
    expect(romaApprovalCheckpointsSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(romaApprovalCheckpointsSql).toContain(`app.assert_roma_project_health_schedule_access(p_workspace_id, p_project_id);`);
    expect(romaApprovalCheckpointsSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
  });

  it('audits approval decisions, rejects ROMA self-approval, and writes as ROMA on approve', () => {
    expect(romaApprovalCheckpointsSql).toContain(`'approval.checkpoint.requested'`);
    expect(romaApprovalCheckpointsSql).toContain(`'approval.checkpoint.approved'`);
    expect(romaApprovalCheckpointsSql).toContain(`'approval.checkpoint.denied'`);
    expect(romaApprovalCheckpointsSql).toContain(`'approval.checkpoint.expired'`);
    expect(romaApprovalCheckpointsSql).toContain(`RAISE EXCEPTION 'roma cannot self-approve approval checkpoints'`);
    expect(romaApprovalCheckpointsSql).toContain(`RAISE EXCEPTION 'owner approval required'`);
    expect(romaApprovalCheckpointsSql).toContain(`app.api_capture_connector_record(`);
    expect(romaApprovalCheckpointsSql).toContain(`v_checkpoint.execution_subject_id`);
    expect(romaApprovalCheckpointsSql).toContain(`'roma.qa_finding.written'`);
  });

  it('keeps checkpoint payloads bounded to finding metadata instead of raw bodies', () => {
    expect(romaApprovalCheckpointsSql).toContain(`app.sanitize_roma_qa_finding_evidence_refs`);
    expect(romaApprovalCheckpointsSql).toContain(`'evidenceRefs', app.sanitize_roma_qa_finding_evidence_refs(p_evidence_refs)`);
    expect(romaApprovalCheckpointsSql).toContain(
      `this finding stores titles and structured evidence refs only; raw memory bodies are not quoted.`,
    );
    expect(romaApprovalCheckpointsSql).not.toContain(`'content'`);
  });

  it('adds explicit per-project ROMA action budgets without defaulting to AISTROYKA', () => {
    expect(romaActionBudgetsSql).toContain(`CREATE TABLE roma_action_budgets`);
    expect(romaActionBudgetsSql).toContain(`CREATE TABLE roma_action_budget_events`);
    expect(romaActionBudgetsSql).toContain(`UNIQUE (workspace_id, project_id)`);
    expect(romaActionBudgetsSql).toContain(`'roma_project_health_write'`);
    expect(romaActionBudgetsSql).toContain(`'roma_project_finding_write'`);
    expect(romaActionBudgetsSql).toContain(`'roma_approval_checkpoint_write'`);
    expect(romaActionBudgetsSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(romaActionBudgetsSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
  });

  it('prevents ROMA from raising its own budget and audits fail-closed rejections', () => {
    expect(romaActionBudgetsSql).toContain(`RAISE EXCEPTION 'roma cannot raise its own action budget'`);
    expect(romaActionBudgetsSql).toContain(`'roma.action_budget.upserted'`);
    expect(romaActionBudgetsSql).toContain(`'roma.action_budget.rejected'`);
    expect(romaActionBudgetsSql).toContain(`roma action budget not configured for project`);
    expect(romaActionBudgetsSql).toContain(`roma action budget exceeded for project`);
  });

  it('enforces budgets atomically inside capture and approval writes', () => {
    expect(romaActionBudgetsSql).toContain(`CREATE OR REPLACE FUNCTION app.api_capture_connector_record`);
    expect(romaActionBudgetsSql).toContain(`v_provider = 'roma'`);
    expect(romaActionBudgetsSql).toContain(`app.consume_roma_action_budget(`);
    expect(romaActionBudgetsSql).toContain(`RETURN jsonb_strip_nulls(jsonb_build_object(`);
    expect(romaActionBudgetsSql).toContain(`'budgetAuditEventId'`);
    expect(romaActionBudgetsSql).toContain(`IF COALESCE(v_capture->>'error', '') <> '' THEN`);
    expect(romaActionBudgetsSql).toContain(`'status', v_checkpoint.status`);
  });

  it('allows approved checkpoint writes to carry both job and checkpoint lineage', () => {
    expect(romaActionBudgetsSql).toContain(
      `CONSTRAINT roma_action_budget_events_source_checkpoint_type CHECK (`,
    );
    expect(romaActionBudgetsSql).toContain(
      `source_checkpoint_id IS NULL
    OR action_type = 'roma_approval_checkpoint_write'`,
    );
    expect(romaActionBudgetsSql).not.toContain(
      `CONSTRAINT roma_action_budget_events_source_pair CHECK (
    source_job_id IS NULL
    OR source_checkpoint_id IS NULL
  )`,
    );
  });

  it('adds a project-scoped proactive consolidation enqueue without defaulting to AISTROYKA', () => {
    expect(proactiveConsolidationSql).toContain(
      `CREATE OR REPLACE FUNCTION app.api_enqueue_project_consolidation`,
    );
    expect(proactiveConsolidationSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(proactiveConsolidationSql).toContain(
      `RAISE EXCEPTION 'owner subject required for proactive consolidation'`,
    );
    expect(proactiveConsolidationSql).toContain(`'projectId', p_project_id`);
    expect(proactiveConsolidationSql).toContain(`'mode', 'proactive'`);
    expect(proactiveConsolidationSql).toContain(`'memory.consolidation.requested'`);
    expect(proactiveConsolidationSql).toContain(`'project'`);
    expect(proactiveConsolidationSql).not.toContain(
      `'44444444-4444-4444-8444-444444444401'`,
    );
  });

  it('keys proactive consolidation idempotency by explicit project and minute bucket', () => {
    expect(proactiveConsolidationSql).toContain(`'consolidate/%s/%s/%s'`);
    expect(proactiveConsolidationSql).toContain(`p_project_id::text`);
    expect(proactiveConsolidationSql).toContain(
      `AND o.payload->>'idempotencyKey' = v_idem`,
    );
  });

  it('adds durable contradiction candidates without defaulting to AISTROYKA', () => {
    expect(contradictionDetectionSql).toContain(`CREATE TABLE memory_conflicts`);
    expect(contradictionDetectionSql).toContain(`ALTER TABLE memory_conflicts ENABLE ROW LEVEL SECURITY;`);
    expect(contradictionDetectionSql).toContain(`ALTER TABLE memory_conflicts FORCE ROW LEVEL SECURITY;`);
    expect(contradictionDetectionSql).toContain(`UNIQUE (workspace_id, project_id, conflict_key)`);
    expect(contradictionDetectionSql).toContain(`CREATE OR REPLACE FUNCTION app.api_upsert_memory_conflict`);
    expect(contradictionDetectionSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(contradictionDetectionSql).toContain(
      `RAISE EXCEPTION 'owner subject required for contradiction detection'`,
    );
    expect(contradictionDetectionSql).not.toContain(
      `'44444444-4444-4444-8444-444444444401'`,
    );
  });

  it('sanitizes contradiction evidence refs down to memory ids and titles only', () => {
    expect(contradictionDetectionSql).toContain(
      `CREATE OR REPLACE FUNCTION app.sanitize_memory_conflict_evidence_refs`,
    );
    expect(contradictionDetectionSql).toContain(`CREATE POLICY memory_conflicts_select`);
    expect(contradictionDetectionSql).toContain(
      `app.has_acl(workspace_id, 'project', 'read', project_id, 'internal')`,
    );
    expect(contradictionDetectionSql).toContain(`CREATE POLICY memory_conflicts_no_insert`);
    expect(contradictionDetectionSql).toContain(`WITH CHECK (false);`);
    expect(contradictionDetectionSql).toContain(`CREATE POLICY memory_conflicts_no_update`);
    expect(contradictionDetectionSql).toContain(`USING (false)`);
    expect(contradictionDetectionSql).toContain(`CREATE POLICY memory_conflicts_no_delete`);
    expect(contradictionDetectionSql).toContain(`'memoryId'`);
    expect(contradictionDetectionSql).toContain(`'title'`);
    expect(contradictionDetectionSql).not.toContain(`'content'`);
  });

  it('adds project-scoped personalized importance without defaulting to AISTROYKA', () => {
    expect(personalizedImportanceSql).toContain(`CREATE TABLE memory_personalizations`);
    expect(personalizedImportanceSql).toContain(
      `UNIQUE (workspace_id, project_id, memory_id, scope_key)`,
    );
    expect(personalizedImportanceSql).toContain(
      `CREATE OR REPLACE FUNCTION app.api_set_memory_personalization`,
    );
    expect(personalizedImportanceSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(personalizedImportanceSql).not.toContain(
      `'44444444-4444-4444-8444-444444444401'`,
    );
  });

  it('keeps personalization rows actor-private or project-default only and versioned', () => {
    expect(personalizedImportanceSql).toContain(
      `scope IN ('actor', 'project_default')`,
    );
    expect(personalizedImportanceSql).toContain(
      `scope = 'project_default'
      OR actor_subject_id = app.current_subject_id()`,
    );
    expect(personalizedImportanceSql).toContain(`FROM memory_records mr`);
    expect(personalizedImportanceSql).toContain(`mr.sensitivity`);
    expect(personalizedImportanceSql).toContain(`ranking_version text NOT NULL DEFAULT 'm13-s05-v1'`);
    expect(personalizedImportanceSql).toContain(`version integer NOT NULL DEFAULT 1`);
    expect(personalizedImportanceSql).toContain(`'owner subject required for project-default personalization'`);
  });

  it('applies personalized importance inside search only after ACL-visible memories are selected', () => {
    expect(personalizedImportanceSql).toContain(`LEFT JOIN LATERAL (`);
    expect(personalizedImportanceSql).toContain(`FROM memory_personalizations mp`);
    expect(personalizedImportanceSql).toContain(
      `(mp.scope = 'actor' AND mp.actor_subject_id = p_subject_id)`,
    );
    expect(personalizedImportanceSql).toContain(`OR mp.scope = 'project_default'`);
    expect(personalizedImportanceSql).toContain(
      `AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)`,
    );
    expect(personalizedImportanceSql).toContain(`'memory.personalization.set'`);
    expect(personalizedImportanceSql).toContain(`'memory.personalization.cleared'`);
  });

  it('lets the same payload clear personalization on SQL and keeps pin-only delta null', () => {
    expect(personalizedImportanceSql).toContain(
      `v_should_clear := coalesce(p_pinned, false) = false AND p_importance_delta IS NULL;`,
    );
    expect(personalizedImportanceSql).not.toContain(
      `RAISE EXCEPTION 'pinned or importance_delta required'`,
    );
    expect(personalizedImportanceSql).toContain(`'importanceDelta', NULL`);
    expect(personalizedImportanceSql).toContain(`'importanceDelta', v_next.importance_delta`);
  });

  it('hardens privacy requests with explicit project scope and metadata-only audit logs', () => {
    expect(privacySlaGuardsSql).toContain(`RAISE EXCEPTION 'project_id required'`);
    expect(privacySlaGuardsSql).toContain(`RAISE EXCEPTION 'project mismatch'`);
    expect(privacySlaGuardsSql).toContain(`'privacy request submitted'`);
    expect(privacySlaGuardsSql).toContain(`'targetMemoryId', p_target_memory_id`);
    expect(privacySlaGuardsSql).not.toContain(`'44444444-4444-4444-8444-444444444401'`);
    expect(privacySlaGuardsSql).not.toContain(`reason,\n    btrim(p_reason)`);
  });
});

describe('P0 project identity migration guards', () => {
  const p0Sql = readFileSync(p0ProjectIdentityMigrationPath, 'utf8');

  it('removes legacy Cursor AISTROYKA ACL on upgrade', () => {
    expect(p0Sql).toContain(`DELETE FROM acl_entries a`);
    expect(p0Sql).toContain(`AND s.external_key = 'cursor'`);
    expect(p0Sql).toContain(
      `AND a.project_id = '44444444-4444-4444-8444-444444444401'`,
    );
  });

  it('removes workspace-wide agent bypass and scopes Memory OS ACL inserts', () => {
    expect(p0Sql).toContain(`AND a.project_id IS NULL`);
    expect(p0Sql).toContain(
      `'44444444-4444-4444-8444-444444444402'`,
    );
    expect(p0Sql).toMatch(
      /'chatgpt', 'project_state', ARRAY\['read'\]::text\[\]/,
    );
  });

  it('merges M13 personalization with effective project routing in search', () => {
    expect(p0Sql).toContain(`FROM memory_personalizations mp`);
    expect(p0Sql).toContain(`WHEN pref.pinned THEN 1.75`);
    expect(p0Sql).toContain(`app.effective_memory_project_id(m.id)`);
    expect(p0Sql).toContain(`effective_project.effective_project_id`);
    expect(p0Sql).toContain(`'personalization'`);
  });
});

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

describe('m8 slice 03 migration guards', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const aclScopeSql = readFileSync(aclScopeMigrationPath, 'utf8');
  const projectRefFixSql = readFileSync(projectRefFixMigrationPath, 'utf8');
  const replayResyncFixSql = readFileSync(replayResyncFixMigrationPath, 'utf8');
  const romaProjectHealthSql = readFileSync(romaProjectHealthMigrationPath, 'utf8');

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
});

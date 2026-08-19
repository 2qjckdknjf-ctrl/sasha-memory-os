import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819161434_m8_slice_03_projects_chats_ingest.sql', import.meta.url),
);
const aclScopeMigrationPath = fileURLToPath(
  new URL('../../../supabase/migrations/20260819172929_m8_slice_03_acl_scope_and_project_list.sql', import.meta.url),
);

describe('m8 slice 03 migration guards', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const aclScopeSql = readFileSync(aclScopeMigrationPath, 'utf8');

  it('matches connector projects only by unique repository identity', () => {
    expect(sql).toContain(`repo->>'url' = v_repo_url`);
    expect(sql).toContain(`repo->>'external_id' = v_external_id`);
    expect(sql).toContain(`repo->>'collection_id' = p_collection_id`);
    expect(sql).not.toContain(`lower(p.slug) IN (v_owner_hint, v_repo_hint, v_name_hint)`);
    expect(sql).not.toContain(`lower(p.name) IN (lower(v_display_name), lower(coalesce(p_collection_id, '')))`);
    expect(sql).not.toContain(`FROM unnest(coalesce(p.aliases`);
  });

  it('does not grant wildcard project access through null ACL rows', () => {
    expect(sql).not.toContain(`project_id, NULL`);
    expect(sql).not.toContain(`a.project_id IS NULL`);
  });

  it('does not copy the agent ACL pack onto every ingested project', () => {
    expect(sql).not.toContain(`('chatgpt', 'memory'`);
    expect(sql).not.toContain(`('cursor', 'handoff'`);
    expect(sql).not.toContain(`('roma', 'project'`);
  });

  it('overrides ACL matching so workspace scope does not match concrete projects', () => {
    expect(aclScopeSql).toContain(`WHEN p_requested_project_id IS NULL THEN p_acl_project_id IS NULL`);
    expect(aclScopeSql).toContain(`ELSE p_acl_project_id = p_requested_project_id`);
  });
});

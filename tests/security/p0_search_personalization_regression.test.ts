import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const p0MigrationPath = resolve(
  root,
  'supabase/migrations/20260824100000_p0_project_identity_scope.sql',
);
const m13MigrationPath = resolve(
  root,
  'supabase/migrations/20260820050100_m13_slice_05_personalized_importance.sql',
);

describe('P0 search personalization regression', () => {
  const p0Sql = readFileSync(p0MigrationPath, 'utf8');
  const m13Sql = readFileSync(m13MigrationPath, 'utf8');

  it('preserves M13 personalization join and ranking semantics in P0 search', () => {
    expect(p0Sql).toContain('FROM memory_personalizations mp');
    expect(p0Sql).toContain(`WHEN pref.pinned THEN 1.75`);
    expect(p0Sql).toContain(
      `m.importance + coalesce(pref.importance_delta, 0.0)`,
    );
    expect(p0Sql).toContain(`'personalization'`);
    expect(p0Sql).toContain(`'importanceDelta', coalesce(pref.importance_delta, 0.0)`);
    expect(p0Sql).toContain(
      `(mp.scope = 'actor' AND mp.actor_subject_id = p_subject_id)`,
    );
    expect(p0Sql).toContain(`OR mp.scope = 'project_default'`);
  });

  it('combines effective project routing with personalization and ACL', () => {
    expect(p0Sql).toContain('app.effective_memory_project_id(m.id) AS effective_project_id');
    expect(p0Sql).toContain(
      'AND mp.project_id = effective_project.effective_project_id',
    );
    expect(p0Sql).toContain(
      'OR effective_project.effective_project_id = p_project_id',
    );
    expect(p0Sql).toContain(
      `effective_project.effective_project_id`,
    );
    expect(p0Sql).toContain(
      `app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          effective_project.effective_project_id,
          m.sensitivity
        )`,
    );
    expect(p0Sql).not.toMatch(
      /FROM memory_personalizations mp[\s\S]{0,220}AND mp\.project_id = m\.project_id/,
    );
  });

  it('does not drop M13 search anchors present before P0', () => {
    expect(m13Sql).toContain(`WHEN pref.pinned THEN 1.75`);
    expect(m13Sql).toContain(`'personalization'`);
    expect(p0Sql).toContain(`WHEN 'verified' THEN 1.15`);
    expect(p0Sql).toContain(`hybrid:sql+vector-hq`);
  });

  it('aligns memory.get ACL with search effective-project routing', () => {
    expect(p0Sql).toContain('CREATE OR REPLACE FUNCTION app.api_get_memory');
    expect(p0Sql).toContain(
      'v_effective_project_id := app.effective_memory_project_id(v_row.id)',
    );
    expect(p0Sql).toContain(`'effectiveProjectId', v_effective_project_id`);
  });
});

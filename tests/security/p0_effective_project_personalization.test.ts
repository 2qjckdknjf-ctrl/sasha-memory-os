import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const p0MigrationPath = resolve(
  root,
  'supabase/migrations/20260824100000_p0_project_identity_scope.sql',
);
const policyCasesPath = resolve(
  root,
  'tests/security/p0_effective_project_personalization_cases.sql',
);

describe('P0 effective-project personalization', () => {
  const p0Sql = readFileSync(p0MigrationPath, 'utf8');
  const policySql = readFileSync(policyCasesPath, 'utf8');

  it('joins search personalization on effective project, not stored project_id', () => {
    expect(p0Sql).toContain(
      'AND mp.project_id = effective_project.effective_project_id',
    );
    expect(p0Sql).not.toMatch(
      /FROM memory_personalizations mp[\s\S]{0,220}AND mp\.project_id = m\.project_id/,
    );
  });

  it('returns effective and stored project IDs in search personalization payload', () => {
    expect(p0Sql).toContain(`'projectId', effective_project.effective_project_id`);
    expect(p0Sql).toContain(`'storedProjectId', m.project_id`);
  });

  it('validates setter against effective project and stores rows under effective project', () => {
    expect(p0Sql).toContain(
      'v_effective_project_id := app.effective_memory_project_id(v_memory.id)',
    );
    expect(p0Sql).toContain(
      'IF p_project_id IS DISTINCT FROM v_effective_project_id THEN',
    );
    expect(p0Sql).toContain(`'effectiveProjectId', v_effective_project_id`);
    expect(p0Sql).toContain(`'storedProjectId', v_memory.project_id`);
    expect(p0Sql).toMatch(
      /INSERT INTO memory_personalizations[\s\S]{0,400}v_effective_project_id,/,
    );
  });

  it('updates memory_personalizations RLS select policy to effective project', () => {
    expect(p0Sql).toContain('DROP POLICY IF EXISTS memory_personalizations_select');
    expect(p0Sql).toContain(
      'AND app.effective_memory_project_id(mr.id) = memory_personalizations.project_id',
    );
    expect(p0Sql).toContain(
      'app.effective_memory_project_id(mr.id)',
    );
  });

  it('ships ephemeral SQL cases for corrected-memory personalization lifecycle', () => {
    expect(policySql).toContain('aistroyka_project_default_ignored_after_correction');
    expect(policySql).toContain('memory_os_project_default_applies');
    expect(policySql).toContain('cursor_actor_pref_beats_project_default');
    expect(policySql).toContain('cursor set via effective project');
    expect(policySql).toContain('cursor_set_via_stored_aistroyka_forbidden');
    expect(policySql).toContain('project_context_includes_effective_routed_memory');
    expect(policySql).toContain('uncorrected_memory_keeps_m13_behavior');
  });
});

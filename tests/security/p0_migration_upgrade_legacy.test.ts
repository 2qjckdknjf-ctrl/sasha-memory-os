import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyP0AclRemediation,
  buildLegacyPreP0AclEntries,
} from '@memory-os/authz';

const root = resolve(import.meta.dirname, '../..');
const p0MigrationPath = resolve(
  root,
  'supabase/migrations/20260824100000_p0_project_identity_scope.sql',
);
const policyCasesPath = resolve(
  root,
  'tests/security/p0_migration_upgrade_legacy_cases.sql',
);

describe('P0 migration upgrade from legacy state', () => {
  const p0Sql = readFileSync(p0MigrationPath, 'utf8');
  const upgradeSql = readFileSync(policyCasesPath, 'utf8');

  it('uses idempotent DDL for corrections table, RLS, ACL inserts, and policies', () => {
    expect(p0Sql).toContain('CREATE TABLE IF NOT EXISTS project_routing_corrections');
    expect(p0Sql).toContain('ON CONFLICT (memory_id) DO UPDATE SET');
    expect(p0Sql).toContain('DROP POLICY IF EXISTS memory_personalizations_select');
    expect(p0Sql).toContain('AND NOT EXISTS');
  });

  it('remediates legacy ACL without requiring fresh seed', () => {
    const upgraded = applyP0AclRemediation(buildLegacyPreP0AclEntries());
    const cursorAistroyka = upgraded.filter(
      (e) =>
        e.subjectId === '33333333-3333-4333-8333-333333333303' &&
        e.projectId === '44444444-4444-4444-8444-444444444401',
    );
    expect(cursorAistroyka).toHaveLength(0);
    const twice = applyP0AclRemediation(upgraded);
    expect(twice.length).toBe(upgraded.length);
  });

  it('ships ephemeral upgrade regression with pre-seeded corrections and personalizations', () => {
    expect(upgradeSql).toContain('legacy_routing_correction_preserved');
    expect(upgradeSql).toContain('legacy_personalization_under_stored_project_ignored');
    expect(upgradeSql).toContain('reapply_p0_blocks_idempotent');
    expect(upgradeSql).toContain('rls_still_enabled_after_upgrade');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorize,
  applyP0AclRemediation,
  buildLegacyPreP0AclEntries,
  buildProductionAgentAclEntries,
} from '@memory-os/authz';
import {
  AISTROYKA_PROJECT_ID,
  CHATGPT_SUBJECT_ID,
  CURSOR_SUBJECT_ID,
  HIAIR_PROJECT_ID,
  SASHA_MEMORY_OS_PROJECT_ID,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const migrationPath = resolve(
  root,
  'supabase/migrations/20260824100000_p0_project_identity_scope.sql',
);
const seedPath = resolve(root, 'supabase/seed.sql');

describe('P0 ACL migration upgrade regression', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const seedSql = readFileSync(seedPath, 'utf8');

  it('migration deletes legacy Cursor AISTROYKA grants and workspace-wide bypass', () => {
    expect(migrationSql).toContain(
      `AND s.external_key = 'cursor'`,
    );
    expect(migrationSql).toContain(
      `AND a.project_id = '44444444-4444-4444-8444-444444444401'`,
    );
    expect(migrationSql).toContain(
      `AND a.resource_type IN ('memory', 'project', 'project_state', 'handoff', 'session')`,
    );
    expect(migrationSql).toContain(`AND a.project_id IS NULL`);
    expect(migrationSql).toContain(
      `AND s.external_key IN ('chatgpt', 'cursor')`,
    );
  });

  it('seed SQL gives ChatGPT project_state read-only on Memory OS', () => {
    expect(seedSql).toContain(
      `'44444444-4444-4444-8444-444444444402'`,
    );
    expect(seedSql).toMatch(
      /'33333333-3333-4333-8333-333333333302'[\s\S]{0,400}?'project_state'[\s\S]{0,120}?ARRAY\['read'\]/,
    );
    expect(seedSql).not.toMatch(
      /'33333333-3333-4333-8333-333333333302'[\s\S]{0,400}?'project_state'[\s\S]{0,120}?ARRAY\['read', 'write'\]/,
    );
  });

  it('proves upgrade from legacy ACL state without relying on fresh seed', () => {
    const upgraded = applyP0AclRemediation(buildLegacyPreP0AclEntries());
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const cursorCtx = {
      subjectId: CURSOR_SUBJECT_ID,
      workspaceId,
      isOwner: false,
      entries: upgraded.filter((e) => e.subjectId === CURSOR_SUBJECT_ID),
    };

    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: SASHA_MEMORY_OS_PROJECT_ID,
        sensitivity: 'internal',
      }),
    ).toBe(true);
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: AISTROYKA_PROJECT_ID,
        sensitivity: 'internal',
      }),
    ).toBe(false);
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: HIAIR_PROJECT_ID,
        sensitivity: 'internal',
      }),
    ).toBe(false);
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: null,
        sensitivity: 'internal',
      }),
    ).toBe(false);
  });

  it('matches offline production ACL matrix to SQL-backed configuration', () => {
    const production = buildProductionAgentAclEntries();
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const matrix: Array<{
      subjectId: string;
      resourceType: string;
      action: string;
      projectId: string;
      expected: boolean;
    }> = [
      {
        subjectId: CURSOR_SUBJECT_ID,
        resourceType: 'memory',
        action: 'write',
        projectId: SASHA_MEMORY_OS_PROJECT_ID,
        expected: true,
      },
      {
        subjectId: CURSOR_SUBJECT_ID,
        resourceType: 'memory',
        action: 'write',
        projectId: AISTROYKA_PROJECT_ID,
        expected: false,
      },
      {
        subjectId: CURSOR_SUBJECT_ID,
        resourceType: 'memory',
        action: 'write',
        projectId: HIAIR_PROJECT_ID,
        expected: false,
      },
      {
        subjectId: CHATGPT_SUBJECT_ID,
        resourceType: 'project_state',
        action: 'read',
        projectId: SASHA_MEMORY_OS_PROJECT_ID,
        expected: true,
      },
      {
        subjectId: CHATGPT_SUBJECT_ID,
        resourceType: 'project_state',
        action: 'write',
        projectId: SASHA_MEMORY_OS_PROJECT_ID,
        expected: false,
      },
      {
        subjectId: CHATGPT_SUBJECT_ID,
        resourceType: 'memory',
        action: 'write',
        projectId: AISTROYKA_PROJECT_ID,
        expected: true,
      },
    ];

    for (const row of matrix) {
      const ctx = {
        subjectId: row.subjectId,
        workspaceId,
        isOwner: false,
        entries: production.filter((e) => e.subjectId === row.subjectId),
      };
      expect(
        authorize(ctx, {
          resourceType: row.resourceType,
          action: row.action,
          projectId: row.projectId,
          sensitivity: 'internal',
        }),
        `${row.subjectId} ${row.resourceType}.${row.action}@${row.projectId}`,
      ).toBe(row.expected);
    }
  });
});

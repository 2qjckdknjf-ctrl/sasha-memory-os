import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AISTROYKA_PROJECT_ID,
  CANONICAL_PROJECT_ID,
  HIAIR_PROJECT_ID,
  OFFICIAL_P0_PROJECT_IDENTITY_PACK,
  OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION,
  SASHA_MEMORY_OS_PROJECT_ID,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('P0 project identity security pack', () => {
  it('keeps distinct canonical project UUIDs', () => {
    expect(OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION).toBe('p0-project-identity-v1');
    expect(CANONICAL_PROJECT_ID).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(CANONICAL_PROJECT_ID).not.toBe(AISTROYKA_PROJECT_ID);
    expect(HIAIR_PROJECT_ID).not.toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(OFFICIAL_P0_PROJECT_IDENTITY_PACK.invariants.oneUuidPerProject).toBe(true);
  });

  it('checks migration and routing manifest anchors', () => {
    expect(
      existsSync(
        resolve(root, 'supabase/migrations/20260824100000_p0_project_identity_scope.sql'),
      ),
    ).toBe(true);
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          root,
          'apps/api/fixtures/project-routing/p0-project-identity-v1/routing-manifest.json',
        ),
        'utf8',
      ),
    );
    expect(manifest.version).toBe('p0-project-identity-v1');
    expect(manifest.projects.sashaMemoryOs).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(manifest.dryRun).toBe(true);
  });

  it('documents preflight baseline', () => {
    const preflight = JSON.parse(
      readFileSync(resolve(root, 'docs/engineering/SHARED_MEMORY_PREFLIGHT.json'), 'utf8'),
    );
    expect(preflight.projects.sashaMemoryOs).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(preflight.projects.aistroyka).toBe(AISTROYKA_PROJECT_ID);
    expect(preflight.acceptanceGates.projectIsolation).toBe('IN_PROGRESS');
  });
});

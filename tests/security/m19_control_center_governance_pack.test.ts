import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

function repoFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('M19 Control Center governance pack', () => {
  it('maps all canonical owner workflows to real surfaces', () => {
    expect(OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK).toMatchObject({
      version: 'm19-s01-v1',
      invariants: {
        ownerOnlyMutations: true,
        explicitWorkspaceRequired: true,
        noDemoActorSwitchingOnOwnerSurface: true,
        rawSecretsNeverReturned: true,
        rawPrivatePayloadsNeverReturned: true,
        replayDeadLetterOnly: true,
      },
    });
    expect(OFFICIAL_M19_CONTROL_CENTER_GOVERNANCE_PACK.mandatorySurfaces).toHaveLength(10);
  });

  it('wires owner API, browser surface, SQL boundary cases, and CI', () => {
    const api = repoFile('apps/api/src/app.ts');
    const gateway = repoFile('packages/db/src/gateway.ts');
    const page = repoFile('apps/web/src/GovernancePage.tsx');
    const connections = repoFile('apps/web/src/ConnectionsPage.tsx');
    const migration = repoFile(
      'supabase/migrations/20261015200000_m19_control_center_governance.sql',
    );
    const ephemeral = repoFile('scripts/ci-ephemeral-shared-memory-smoke.sh');
    const docs = repoFile('docs/engineering/M19_CONTROL_CENTER_GOVERNANCE.md');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(api).toContain("'/v1/governance/overview'");
    expect(api).toContain("'/v1/routing/unclassified'");
    expect(api).toContain("'/v1/routing/:memoryId/correct'");
    expect(api).toContain("'/v1/jobs'");
    expect(gateway).toContain('api_control_center_overview');
    expect(gateway).toContain('api_list_unclassified_memories');
    expect(gateway).toContain('api_list_processing_jobs');
    expect(page).toContain('Все governance-поверхности');
    expect(page).not.toContain('onActorChange');
    expect(connections).toContain('Opaque values скрыты');
    expect(migration).toContain('app.assert_workspace_owner');
    expect(migration).toContain('TO service_role');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(ephemeral).toContain('m19_control_center_governance_cases.sql');
    expect(docs).toContain('/governance#routing-inbox');
    expect(current).toMatchObject({
      completedThrough: 'M18.4',
      nextSlice: 'M19_CONTROL_CENTER_GOVERNANCE_COMPLETION',
      officialPacks: { m19ControlCenterGovernance: 'm19-s01-v1' },
      supabase: {
        latestMigration: '20261015200000_m19_control_center_governance.sql',
        migrationCount: 76,
      },
    });
  });
});

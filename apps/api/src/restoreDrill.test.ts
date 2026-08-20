import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_DR_RESTORE_DRILL_PACK } from '@memory-os/observability';
import {
  OFFICIAL_M14_DR_RESTORE_RECIPE,
  OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION,
  resolveRestoreDrillConfig,
  resolveRestoreDrillConfigFromEnv,
  runRestoreDrillRecipe,
} from './restoreDrill.js';

const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/dr-restore-drill/m14-s04-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

function createFixtureCopy(name: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), `${name}-`));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

function overwriteJson(relativePath: string, fixtureDir: string, value: unknown): void {
  writeFileSync(resolve(fixtureDir, relativePath), JSON.stringify(value, null, 2));
}

function readJson(relativePath: string, fixtureDir: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, relativePath), 'utf8'));
}

describe('bounded DR restore drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 04 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION).toBe('m14-s04-v1');
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.version).toBe('m14-s04-v1');
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.packVersion).toBe(
      OFFICIAL_M14_DR_RESTORE_DRILL_PACK.version,
    );
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.roadmapSections).toEqual([
      '7.5',
      '20.17',
    ]);
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.targets).toEqual(
      OFFICIAL_M14_DR_RESTORE_DRILL_PACK.targets.map((target) => target.id),
    );
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxBackupContours: 2,
      maxOwnerExportEvidenceFiles: 1,
    });
    expect(OFFICIAL_M14_DR_RESTORE_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
      requireIndependentBackupContours: true,
      requireExplicitProjectIdOnWriteOrExportInvocation: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      allowLiveRestore: false,
      allowProductionSqlApply: false,
      logPayloadBodies: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('requires an explicit project_id when owner export evidence is present', () => {
    expect(() =>
      resolveRestoreDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_DEFAULT_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveRestoreDrillConfigFromEnv({
        MEMORY_OS_DR_RESTORE_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('proves the two backup contours and full restore checklist from the canned fixture', async () => {
    const report = await runRestoreDrillRecipe({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.modeAToolCount).toBe(CHATGPT_PILOT_TOOLS.length);
    expect(report.contours.database.includesArchivedStorageObjects).toBe(false);
    expect(report.contours.storage.versionedCopy).toBe(true);
    expect(report.contours.storage.offsiteCopy).toBe(true);
    expect(report.restore.checkStatus).toMatchObject({
      'rows-present': true,
      'rls-after-restore': true,
      'checksum-verify': true,
      'embedding-index-rebuild': true,
      'provenance-sample': true,
    });
    expect(report.restore.projectScopedOwnerExport).toBe(true);
    expect(report.restore.verifiedWritesCreated).toBe(0);
    expect(JSON.stringify(report)).not.toContain('super-secret-memory-body');
  });

  it('fails closed when the restore report only checks rows and omits RLS, checksums, index rebuild, or provenance', async () => {
    const fixtureDir = createFixtureCopy('restore-drill-rows-only');
    const reportFixture = readJson('restore-report.json', fixtureDir) as Record<string, unknown>;
    overwriteJson('restore-report.json', fixtureDir, {
      ...reportFixture,
      checks: [
        {
          id: 'rows-present',
          ok: true,
          summary: 'Rows exist, but nothing else was validated.',
        },
      ],
      rlsVerification: { ok: false, matrixCases: [] },
      checksumVerification: { ok: false, verifiedObjects: 0, algorithms: [] },
      embeddingIndexRebuild: { ok: false, rebuiltIndexIds: [], rebuiltEmbeddings: 0 },
      selectiveProvenance: { ok: false, sampleMemoryIds: [], reproducibleFields: [] },
    });

    const report = await runRestoreDrillRecipe({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'restore drill is missing required check: rls-after-restore',
        'restore drill is missing required check: checksum-verify',
        'restore drill is missing required check: embedding-index-rebuild',
        'restore drill is missing required check: provenance-sample',
        'restore drill must verify RLS deny cases after restore',
        'restore drill must verify archived object checksums after restore',
        'restore drill must verify embedding/index rebuild after restore',
        'restore drill must verify selective provenance reproducibility',
      ]),
    );
  });

  it('fails closed when database and storage backup contours are no longer independent', async () => {
    const fixtureDir = createFixtureCopy('restore-drill-independent-contours');
    const dbManifest = readJson('db-backup-manifest.json', fixtureDir) as Record<string, unknown>;
    const storageManifest = readJson(
      'storage-archive-manifest.json',
      fixtureDir,
    ) as Record<string, unknown>;

    overwriteJson('db-backup-manifest.json', fixtureDir, {
      ...dbManifest,
      includesArchivedStorageObjects: true,
    });
    overwriteJson('storage-archive-manifest.json', fixtureDir, {
      ...storageManifest,
      versionedCopy: false,
      offsiteCopy: false,
    });

    const report = await runRestoreDrillRecipe({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'database backup contour must not claim to restore archived Storage objects',
        'storage backup contour must remain versioned and off-site',
      ]),
    );
  });

  it('fails closed on payload-leak or verified-write regressions without echoing sensitive export payloads', async () => {
    const fixtureDir = createFixtureCopy('restore-drill-payload');
    const reportFixture = readJson('restore-report.json', fixtureDir) as Record<string, unknown>;

    overwriteJson('restore-report.json', fixtureDir, {
      ...reportFixture,
      verifiedWritesCreated: 1,
    });
    overwriteJson('owner-export-metadata.json', fixtureDir, {
      format: 'memory-os.export.memories.v1',
      workspaceId,
      projectId: explicitProjectId,
      count: 1,
      payloadStored: false,
      sampleMemoryIds: ['mem-restore-sample-1'],
      memories: [{ id: 'mem-restore-sample-1', content: 'super-secret-memory-body' }],
    });

    const report = await runRestoreDrillRecipe({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'restore drill must not create verified memory writes',
        'owner export evidence must stay metadata-only (memories, memories[0].content)',
      ]),
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('super-secret-memory-body');
  });
});

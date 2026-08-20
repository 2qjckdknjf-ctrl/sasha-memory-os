import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_DR_RESTORE_DRILL_PACK,
  OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 04 bounded DR restore drill pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION).toBe('m14-s04-v1');
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK.version).toBe('m14-s04-v1');
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK.roadmapSections).toEqual([
      '7.5',
      '20.17',
    ]);
    expect(OFFICIAL_M14_DR_RESTORE_DRILL_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      fixtureOnly: true,
      modeAToolCount: 7,
      requireIndependentDatabaseBackupContour: true,
      requireIndependentStorageArchiveContour: true,
      databaseBackupRestoresStorageObjects: false,
      maxDatabaseRpoMinutesWithPitr: 15,
      requireDocumentedDailyDatabaseRpoWithoutPitr: true,
      maxArchivedObjectRpoHours: 24,
      maxPrivateBetaRtoHours: 8,
      requireQuarterlyRestoreDrill: true,
      requirePreGaRestoreDrill: true,
      checkRowsPresent: true,
      checkRlsAfterRestore: true,
      checkObjectChecksums: true,
      checkEmbeddingIndexRebuild: true,
      checkSelectiveProvenanceReproducibility: true,
      requireExplicitProjectIdOnWriteOrExportInvocation: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      allowLiveRestore: false,
      allowProductionSqlApply: false,
      logMemoryBodies: false,
      logTokens: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_DR_RESTORE_DRILL_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official DR restore checklist coverage', () => {
    expect(
      OFFICIAL_M14_DR_RESTORE_DRILL_PACK.targets.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        'db-backup-contour',
        'storage-backup-contour',
        'rls-after-restore',
        'checksum-verify',
        'embedding-index-rebuild',
        'provenance-sample',
      ]),
    );
    expect(
      OFFICIAL_M14_DR_RESTORE_DRILL_PACK.checklist.find(
        (item) => item.id === 'db-backup-contour',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'docs/adr/ADR-003-storage-modes.md',
        'apps/api/src/restoreDrill.ts',
        'apps/api/src/restoreDrill.test.ts',
      ]),
    );
  });

  it('documents bounded scope and non-production exclusions', () => {
    const doc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_04.md'),
      'utf8',
    );
    expect(doc).toContain('Official pack version: `m14-s04-v1`');
    expect(doc).toContain('Roadmap sections: `7.5`, `20.17`');
    expect(doc).toMatch(/## In scope/);
    expect(doc).toMatch(/## Out of scope/);
    expect(doc).toMatch(/database backup is not the same as archived Storage backup/i);
    expect(doc).toMatch(/row presence is necessary but not sufficient/i);
    expect(doc).toMatch(/verify RLS after restore/i);
    expect(doc).toMatch(/verify archived object checksums/i);
    expect(doc).toMatch(/verify embedding\/index rebuild/i);
    expect(doc).toMatch(/verify selective provenance reproducibility/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/explicit `project_id`/i);
    expect(doc).toMatch(/No SQL migration is required/i);
    expect(doc).toMatch(/No production SQL apply/i);
    expect(doc).toMatch(/No live production restore/i);
    expect(doc).toMatch(/requires owner approval/i);
  });
});

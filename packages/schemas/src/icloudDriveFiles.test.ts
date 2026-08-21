import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK,
  OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION,
  decideFilesIngest,
  isProviderItemInSelectedScope,
  trackFilesVersionChecksum,
} from './icloudDriveFiles.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M16.3 iCloud Drive / Files pack', () => {
  it('publishes selected-scope files pack without live picker E2E PASS', () => {
    expect(OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION).toBe('m16-s03-v1');
    expect(OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK.invariants).toMatchObject({
      selectedScopeOnly: true,
      metadataFirstIndexing: true,
      neverFullHomeOrIcloudWalk: true,
      neverServerSideIcloudScrape: true,
      claimLiveFilesPickerE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('enforces selected scope, metadata-first, version keys, and delete tombstones', () => {
    const scope = {
      projectId,
      bookmarkIds: ['bm-docs'],
      allowDescendantsOfDirectories: true as const,
    };
    expect(
      isProviderItemInSelectedScope({
        scope,
        providerItemId: 'file-1',
        bookmarkId: 'bm-docs',
        isExactSelection: false,
        isChildOfSelectedDirectory: true,
      }),
    ).toBe(true);
    expect(
      isProviderItemInSelectedScope({
        scope,
        providerItemId: 'file-2',
        bookmarkId: 'bm-other',
        isExactSelection: true,
        isChildOfSelectedDirectory: false,
      }),
    ).toBe(false);

    expect(
      decideFilesIngest({
        projectId,
        inScope: true,
        changeKind: 'upsert',
        contentExtractionPermitted: false,
        binaryStorageAllowed: false,
      }),
    ).toMatchObject({
      ingestMode: 'metadata_first',
      binaryPolicy: 'store_reference_only',
    });

    expect(
      decideFilesIngest({
        projectId,
        inScope: true,
        changeKind: 'delete',
        contentExtractionPermitted: true,
        binaryStorageAllowed: true,
      }).tombstone,
    ).toBe(true);

    expect(
      decideFilesIngest({
        projectId,
        inScope: false,
        changeKind: 'upsert',
        contentExtractionPermitted: true,
        binaryStorageAllowed: true,
      }),
    ).toMatchObject({ inScope: false, tombstone: true });

    expect(
      trackFilesVersionChecksum({
        providerItemId: 'file-1',
        bookmarkId: 'bm-docs',
        displayName: 'Spec.md',
        isDirectory: false,
        contentVersion: 'v3',
        checksum: 'abc',
      }).versionKey,
    ).toBe('v3@abc');

    expect(() =>
      decideFilesIngest({
        projectId: ' ',
        inScope: true,
        changeKind: 'upsert',
        contentExtractionPermitted: true,
        binaryStorageAllowed: true,
      }),
    ).toThrow(/project_id is required/);
  });
});

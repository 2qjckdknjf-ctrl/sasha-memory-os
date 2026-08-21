import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M16_PHOTOS_PACK,
  OFFICIAL_M16_PHOTOS_PACK_VERSION,
  decidePhotosIngest,
  photosAssetIdempotencyKey,
} from './photosIngest.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M16.4 Photos pack', () => {
  it('publishes photos pack without live PhotoKit E2E PASS', () => {
    expect(OFFICIAL_M16_PHOTOS_PACK_VERSION).toBe('m16-s04-v1');
    expect(OFFICIAL_M16_PHOTOS_PACK.invariants).toMatchObject({
      noSilentBulkSemanticAnalysis: true,
      limitedPermissionSelectedAssetsOnly: true,
      claimLivePhotoKitE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(OFFICIAL_M16_PHOTOS_PACK.defaults.allowSilentBulkSemanticAnalysis).toBe(
      false,
    );
  });

  it('gates limited library, metadata-only default, and idempotent deletions', () => {
    expect(
      decidePhotosIngest({
        projectId,
        permission: 'limited',
        assetExplicitlySelected: false,
        understandingOptIn: false,
      }).mode,
    ).toBe('reject');

    expect(
      decidePhotosIngest({
        projectId,
        permission: 'limited',
        assetExplicitlySelected: true,
        understandingOptIn: false,
      }).mode,
    ).toBe('metadata_only');

    expect(
      decidePhotosIngest({
        projectId,
        permission: 'full',
        assetExplicitlySelected: true,
        understandingOptIn: true,
      }).mode,
    ).toBe('metadata_plus_explicit_understanding');

    expect(
      decidePhotosIngest({
        projectId,
        permission: 'full',
        assetExplicitlySelected: true,
        understandingOptIn: false,
        deleted: true,
      }).tombstone,
    ).toBe(true);

    expect(
      photosAssetIdempotencyKey({
        localIdentifier: 'asset-1',
        locationAllowed: false,
      }),
    ).toBe('photos:asset-1');

    expect(() =>
      decidePhotosIngest({
        projectId: ' ',
        permission: 'full',
        assetExplicitlySelected: true,
        understandingOptIn: false,
      }),
    ).toThrow(/project_id is required/);
  });
});

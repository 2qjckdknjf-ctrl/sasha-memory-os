import { describe, expect, it } from 'vitest';
import {
  APPLE_CAPABILITY_MATRIX,
  OFFICIAL_M16_APPLE_FEASIBILITY_PACK,
  OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION,
  assertNoServerSideIcloudScrape,
  getAppleCapability,
  listCompanionRequiredCapabilities,
} from './appleCapabilityFeasibility.js';

describe('M16.1 Apple capability feasibility matrix', () => {
  it('publishes matrix without claiming live device E2E PASS', () => {
    expect(OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION).toBe('m16-s01-v1');
    expect(APPLE_CAPABILITY_MATRIX).toHaveLength(6);
    expect(OFFICIAL_M16_APPLE_FEASIBILITY_PACK.invariants).toMatchObject({
      neverServerSideIcloudScrape: true,
      companionRequiredWhereNoPublicCloudApi: true,
      claimLiveDeviceE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(OFFICIAL_M16_APPLE_FEASIBILITY_PACK.liveDeviceE2E.statusInThisSlice).toBe(
      'matrix_only_live_device_blocked',
    );
  });

  it('requires companion bridge and forbids server-side scrape stance', () => {
    expect(assertNoServerSideIcloudScrape()).toBe(true);
    expect(listCompanionRequiredCapabilities()).toEqual(
      expect.arrayContaining([
        'icloud_drive_files',
        'photos',
        'notes',
        'reminders',
        'contacts',
        'device_metadata',
      ]),
    );
    const files = getAppleCapability('icloud_drive_files');
    expect(files.stance).toBe('companion_required');
    expect(files.cannotAutomate.join(' ')).toMatch(/scraping/i);
    expect(getAppleCapability('photos').publicAccessPath).toBe(
      'native_companion_photokit',
    );
  });
});

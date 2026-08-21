export const OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION = 'm16-s01-v1' as const;

export type AppleCapabilityId =
  | 'icloud_drive_files'
  | 'photos'
  | 'notes'
  | 'reminders'
  | 'contacts'
  | 'device_metadata';

export type AppleAccessPath =
  | 'native_companion_photokit'
  | 'native_companion_files_bookmarks'
  | 'native_companion_eventkit_or_eventkitui'
  | 'native_companion_contacts'
  | 'native_companion_share_extension'
  | 'server_side_unsupported'
  | 'not_automatable_without_private_api';

export type AppleAutomationStance =
  | 'companion_required'
  | 'companion_preferred'
  | 'out_of_scope_private_api'
  | 'deferred_until_public_api';

export type AppleCapabilityRow = {
  id: AppleCapabilityId;
  displayName: string;
  publicAccessPath: AppleAccessPath;
  platformRestrictions: string[];
  scopesOrEntitlements: string[];
  cannotAutomate: string[];
  stance: AppleAutomationStance;
  bridgeChoice: 'macos_ios_companion' | 'none';
  existingContractSurfaces: string[];
};

export const APPLE_CAPABILITY_MATRIX: readonly AppleCapabilityRow[] = [
  {
    id: 'icloud_drive_files',
    displayName: 'iCloud Drive / Files',
    publicAccessPath: 'native_companion_files_bookmarks',
    platformRestrictions: [
      'No supported server-side iCloud Drive crawl API for third-party cloud backends',
      'Security-scoped bookmarks required; stale bookmarks need user reselect',
      'Only exact selected files or children of selected directories are in scope',
    ],
    scopesOrEntitlements: [
      'UIDocumentPicker / fileImporter user selection',
      'security-scoped bookmark persistence (Keychain/app container)',
    ],
    cannotAutomate: [
      'Silent full-home or full-iCloud Drive walk',
      'Private/undocumented iCloud scraping from Memory OS servers',
    ],
    stance: 'companion_required',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'packages/schemas/src/appleCompanion.ts (files bookmarks, folder checkpoints)',
      'apps/apple-companion Files bookmark contracts',
      'POST /v1/ingestion/apple-items',
    ],
  },
  {
    id: 'photos',
    displayName: 'Photos',
    publicAccessPath: 'native_companion_photokit',
    platformRestrictions: [
      'PhotoKit limited vs full library permission',
      'Only explicitly selected assets eligible when permission is limited',
      'No silent bulk semantic analysis of private photos without explicit policy',
    ],
    scopesOrEntitlements: [
      'NSPhotoLibraryUsageDescription / limited library picker',
      'PhotoKit change tokens for selected-asset deltas',
    ],
    cannotAutomate: [
      'Full-library scan without user authorization',
      'Server-side Photos library access',
    ],
    stance: 'companion_required',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'appleCompanion photo_library permission + selected assets + change_token',
      'Share Extension photo/video intake (queue-only)',
    ],
  },
  {
    id: 'notes',
    displayName: 'Notes',
    publicAccessPath: 'native_companion_share_extension',
    platformRestrictions: [
      'No public CloudKit Notes dump API for third-party Memory backends',
      'User-mediated share/export or future public frameworks only',
    ],
    scopesOrEntitlements: ['Share Extension / manual export into companion queue'],
    cannotAutomate: [
      'Background scrape of all Notes via private iCloud APIs',
      'Server-side Notes sync without Apple-supported bridge',
    ],
    stance: 'companion_preferred',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'Share Extension text/url intake → apple-items queue',
      'Transferred-objects list/delete contracts',
    ],
  },
  {
    id: 'reminders',
    displayName: 'Reminders',
    publicAccessPath: 'native_companion_eventkit_or_eventkitui',
    platformRestrictions: [
      'EventKit Reminders access is device-local with user permission',
      'iCloud Reminders mirror only through system EventKit, not Memory OS servers',
    ],
    scopesOrEntitlements: ['NSRemindersUsageDescription', 'EventKit Reminders authorization'],
    cannotAutomate: [
      'Server-side Reminders without device companion',
      'Undocumented CalDAV/iCloud credential harvesting',
    ],
    stance: 'companion_required',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'Planned M16.5 selected-source ingest (contract TBD in later slice)',
    ],
  },
  {
    id: 'contacts',
    displayName: 'Contacts',
    publicAccessPath: 'native_companion_contacts',
    platformRestrictions: [
      'CNContactStore requires explicit user authorization',
      'High sensitivity; default to metadata-minimal / opt-in fields',
    ],
    scopesOrEntitlements: ['NSContactsUsageDescription'],
    cannotAutomate: [
      'Bulk export without consent',
      'Server-side iCloud Contacts scraping',
    ],
    stance: 'companion_required',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'Planned M16.5 selected-source ingest (contract TBD in later slice)',
    ],
  },
  {
    id: 'device_metadata',
    displayName: 'Device metadata',
    publicAccessPath: 'native_companion_share_extension',
    platformRestrictions: [
      'Device identity and companion session metadata only; no UDID harvesting beyond needed binding',
      'Must stay least-privilege and project-scoped',
    ],
    scopesOrEntitlements: ['App-attested / Keychain device binding (M16.2)'],
    cannotAutomate: ['Covert fingerprinting beyond stated companion security model'],
    stance: 'companion_required',
    bridgeChoice: 'macos_ios_companion',
    existingContractSurfaces: [
      'Apple companion auth/session scaffold',
      'Encrypted offline queue device binding (M16.2)',
    ],
  },
] as const;

export const OFFICIAL_M16_APPLE_FEASIBILITY_PACK = {
  version: OFFICIAL_M16_APPLE_FEASIBILITY_PACK_VERSION,
  roadmapSections: ['16.1', 'apple-capability-feasibility-matrix'],
  decision:
    'Use native macOS/iOS companion bridge for all Apple personal sources; never rely on brittle/private iCloud scraping from servers.',
  capabilities: APPLE_CAPABILITY_MATRIX.map((row) => row.id),
  invariants: {
    neverServerSideIcloudScrape: true,
    companionRequiredWhereNoPublicCloudApi: true,
    selectedScopeOnly: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveDeviceE2EPassFromMocks: false,
  },
  liveDeviceE2E: {
    statusInThisSlice: 'matrix_only_live_device_blocked',
    note: 'Feasibility matrix PASS; live PhotoKit/Files/EventKit device E2E remains later slices / signing.',
  },
} as const;

export function getAppleCapability(id: AppleCapabilityId): AppleCapabilityRow {
  const row = APPLE_CAPABILITY_MATRIX.find((entry) => entry.id === id);
  if (!row) {
    throw new Error(`unknown Apple capability: ${id}`);
  }
  return row;
}

export function listCompanionRequiredCapabilities(
  rows: readonly AppleCapabilityRow[] = APPLE_CAPABILITY_MATRIX,
): AppleCapabilityId[] {
  return rows
    .filter(
      (row) =>
        row.stance === 'companion_required' || row.stance === 'companion_preferred',
    )
    .map((row) => row.id);
}

export function assertNoServerSideIcloudScrape(
  rows: readonly AppleCapabilityRow[] = APPLE_CAPABILITY_MATRIX,
): boolean {
  return rows.every(
    (row) =>
      row.publicAccessPath !== 'server_side_unsupported' ||
      row.stance === 'out_of_scope_private_api' ||
      row.bridgeChoice === 'macos_ios_companion',
  ) && rows.every((row) => row.bridgeChoice !== 'none' || row.stance === 'out_of_scope_private_api');
}

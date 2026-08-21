export const OFFICIAL_M16_PHOTOS_PACK_VERSION = 'm16-s04-v1' as const;

export type PhotosPermission = 'not_determined' | 'limited' | 'full' | 'denied';

export type PhotosIngestMode =
  | 'metadata_only'
  | 'metadata_plus_explicit_understanding'
  | 'reject';

export type PhotosAssetRef = {
  localIdentifier?: string;
  cloudIdentifier?: string;
  albumId?: string | null;
  recordedAt?: string | null;
  /** Location only when sensitivity policy allows. */
  locationAllowed: boolean;
};

export type PhotosIngestDecision = {
  mode: PhotosIngestMode;
  inScope: boolean;
  allowSilentBulkSemanticAnalysis: false;
  tombstone?: boolean;
  reason: string;
};

export const OFFICIAL_M16_PHOTOS_PACK = {
  version: OFFICIAL_M16_PHOTOS_PACK_VERSION,
  roadmapSections: ['16.4', 'photos'],
  defaults: {
    mode: 'metadata_only' as const,
    allowSilentBulkSemanticAnalysis: false,
    requireExplicitUnderstandingOptIn: true,
    limitedLibrarySelectedAssetsOnly: true,
  },
  invariants: {
    userApprovedAccessOnly: true,
    limitedPermissionSelectedAssetsOnly: true,
    metadataFirst: true,
    locationOnlyWhenPolicyAllows: true,
    noSilentBulkSemanticAnalysis: true,
    deletionsIdempotent: true,
    duplicatesIdempotent: true,
    neverServerSidePhotosScrape: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLivePhotoKitE2EPassFromMocks: false,
  },
  livePhotoKitE2E: {
    statusInThisSlice: 'contract_pass_live_photokit_blocked',
    note: 'Photos contracts PASS; live PhotoKit device E2E blocked until signed companion.',
  },
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

export function decidePhotosIngest(input: {
  projectId: string;
  permission: PhotosPermission;
  assetExplicitlySelected: boolean;
  understandingOptIn: boolean;
  deleted?: boolean;
}): PhotosIngestDecision {
  requireExplicitProjectId(input.projectId);

  if (input.permission === 'denied' || input.permission === 'not_determined') {
    return {
      mode: 'reject',
      inScope: false,
      allowSilentBulkSemanticAnalysis: false,
      reason: 'photos permission not granted',
    };
  }

  if (input.deleted) {
    return {
      mode: 'metadata_only',
      inScope: true,
      allowSilentBulkSemanticAnalysis: false,
      tombstone: true,
      reason: 'asset deletion/removal emits idempotent tombstone',
    };
  }

  if (input.permission === 'limited' && !input.assetExplicitlySelected) {
    return {
      mode: 'reject',
      inScope: false,
      allowSilentBulkSemanticAnalysis: false,
      reason: 'limited library: only explicitly selected assets are eligible',
    };
  }

  if (input.understandingOptIn) {
    return {
      mode: 'metadata_plus_explicit_understanding',
      inScope: true,
      allowSilentBulkSemanticAnalysis: false,
      reason: 'explicit understanding opt-in; still no silent bulk semantic analysis',
    };
  }

  return {
    mode: 'metadata_only',
    inScope: true,
    allowSilentBulkSemanticAnalysis: false,
    reason: 'metadata/album/asset identifiers only unless understanding is explicitly opted in',
  };
}

export function photosAssetIdempotencyKey(asset: PhotosAssetRef): string {
  const id =
    asset.localIdentifier?.trim() ||
    asset.cloudIdentifier?.trim() ||
    '';
  if (!id) throw new Error('photos asset requires a durable identifier');
  return `photos:${id}`;
}

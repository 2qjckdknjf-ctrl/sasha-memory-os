export const OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION = 'm16-s03-v1' as const;

export type FilesIngestMode = 'metadata_first' | 'content_when_permitted' | 'reference_only';

export type FilesBinaryPolicy = 'store_governed_object' | 'store_reference_only' | 'omit';

export type FilesChangeKind = 'upsert' | 'move' | 'delete' | 'out_of_scope';

export type SelectedFilesScope = {
  projectId: string;
  bookmarkIds: string[];
  /** Exact selected file ids or descendants of selected directories only. */
  allowDescendantsOfDirectories: true;
};

export type FilesObjectSnapshot = {
  providerItemId: string;
  bookmarkId: string;
  displayName: string;
  isDirectory: boolean;
  contentVersion?: string | null;
  checksum?: string | null;
  parentProviderItemId?: string | null;
};

export type FilesIngestDecision = {
  changeKind: FilesChangeKind;
  ingestMode: FilesIngestMode;
  binaryPolicy: FilesBinaryPolicy;
  inScope: boolean;
  reason: string;
  tombstone?: boolean;
};

export const OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK = {
  version: OFFICIAL_M16_ICLOUD_DRIVE_FILES_PACK_VERSION,
  roadmapSections: ['16.3', 'icloud-drive-files'],
  defaults: {
    ingestMode: 'metadata_first' as const,
    binaryPolicyWhenContentDisallowed: 'store_reference_only' as const,
    allowFullIcloudWalk: false,
    allowServerSideScrape: false,
  },
  invariants: {
    selectedScopeOnly: true,
    metadataFirstIndexing: true,
    versionAndChecksumTracked: true,
    deleteOrMoveEmitsTombstoneOrRescope: true,
    neverFullHomeOrIcloudWalk: true,
    neverServerSideIcloudScrape: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveFilesPickerE2EPassFromMocks: false,
  },
  liveFilesPickerE2E: {
    statusInThisSlice: 'contract_pass_live_picker_blocked',
    note: 'Selected-scope Files contracts PASS; live UIDocumentPicker / security-scoped runtime E2E blocked until signed companion.',
  },
  existingSurfaces: [
    'packages/schemas/src/appleCompanion.ts files bookmarks + folder checkpoints',
    'apps/apple-companion Files bookmark contracts',
    'POST /v1/ingestion/apple-items',
  ],
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

export function isProviderItemInSelectedScope(input: {
  scope: SelectedFilesScope;
  providerItemId: string;
  bookmarkId: string;
  /** True when this item is the exact selected file/folder bookmark target. */
  isExactSelection: boolean;
  /** True when this item is a descendant of a selected directory bookmark. */
  isChildOfSelectedDirectory: boolean;
}): boolean {
  requireExplicitProjectId(input.scope.projectId);
  void input.providerItemId;
  if (!input.scope.bookmarkIds.includes(input.bookmarkId)) return false;
  if (!input.scope.allowDescendantsOfDirectories && input.isChildOfSelectedDirectory) {
    return false;
  }
  return input.isExactSelection || input.isChildOfSelectedDirectory;
}

export function decideFilesIngest(input: {
  projectId: string;
  inScope: boolean;
  changeKind: FilesChangeKind;
  contentExtractionPermitted: boolean;
  binaryStorageAllowed: boolean;
}): FilesIngestDecision {
  requireExplicitProjectId(input.projectId);

  if (!input.inScope || input.changeKind === 'out_of_scope') {
    return {
      changeKind: 'out_of_scope',
      ingestMode: 'reference_only',
      binaryPolicy: 'omit',
      inScope: false,
      reason: 'object outside selected bookmarks/directories — ignore or tombstone prior if needed',
      tombstone: true,
    };
  }

  if (input.changeKind === 'delete' || input.changeKind === 'move') {
    return {
      changeKind: input.changeKind,
      ingestMode: 'metadata_first',
      binaryPolicy: 'omit',
      inScope: true,
      reason:
        input.changeKind === 'delete'
          ? 'delete emits tombstone out of active retrieval'
          : 'move may rescope or tombstone when leaving selected scope',
      tombstone: input.changeKind === 'delete',
    };
  }

  if (!input.contentExtractionPermitted) {
    return {
      changeKind: 'upsert',
      ingestMode: 'metadata_first',
      binaryPolicy: 'store_reference_only',
      inScope: true,
      reason: 'metadata-first indexing; content extraction not permitted',
    };
  }

  return {
    changeKind: 'upsert',
    ingestMode: 'content_when_permitted',
    binaryPolicy: input.binaryStorageAllowed
      ? 'store_governed_object'
      : 'store_reference_only',
    inScope: true,
    reason: input.binaryStorageAllowed
      ? 'content extraction permitted; binary may enter governed object storage'
      : 'content extraction permitted; binary kept as reference only',
  };
}

export function trackFilesVersionChecksum(snapshot: FilesObjectSnapshot): {
  providerItemId: string;
  versionKey: string;
} {
  const version = snapshot.contentVersion?.trim() || 'unknown-version';
  const checksum = snapshot.checksum?.trim() || 'unknown-checksum';
  return {
    providerItemId: snapshot.providerItemId,
    versionKey: `${version}@${checksum}`,
  };
}

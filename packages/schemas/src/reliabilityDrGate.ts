export const OFFICIAL_M20_RELIABILITY_DR_GATE_PACK_VERSION =
  'm20-s02-v1' as const;

export const OFFICIAL_M20_RELIABILITY_DR_GATE_PACK = {
  version: OFFICIAL_M20_RELIABILITY_DR_GATE_PACK_VERSION,
  goal: 'demonstrate recoverability of the current schema, data, jobs, and connector lifecycle before GA',
  requiredGates: [
    'scheduled-database-backup-inventory',
    'isolated-current-schema-restore',
    'rls-acl-after-restore',
    'worker-retry-dead-letter-replay',
    'connector-token-expiry-recovery',
    'storage-object-contour',
    'accepted-rpo-rto',
  ],
  targets: {
    databaseRpoHoursWithoutPitr: 24,
    databaseRpoMinutesWithPitr: 15,
    archivedObjectRpoHours: 24,
    privateBetaRtoHours: 8,
  },
  invariants: {
    databaseAndStorageContoursIndependent: true,
    restoreTargetMustBeIsolatedAndDisposable: true,
    restoreMustUseCurrentRepositorySchema: true,
    restoreMustRecheckRlsAndAcl: true,
    restoreMustCompareMetadataOnlyChecksums: true,
    retryUsesBoundedBackoff: true,
    onlyDeadLetterJobsCanReplay: true,
    tokenLossStopsFutureClaims: true,
    tokenRecoveryRequiresExplicitReauthentication: true,
    productionRestoreAllowedByThisPack: false,
    productionPayloadsMayBeLogged: false,
    storageArchiveRequiredBeforeFirstArchivedObject: true,
  },
} as const;

export type M20ReliabilityDrGatePack =
  typeof OFFICIAL_M20_RELIABILITY_DR_GATE_PACK;

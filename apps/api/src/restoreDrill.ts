import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHATGPT_PILOT_TOOLS, DEFAULT_WORKSPACE_ID } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_DR_RESTORE_DRILL_PACK,
  OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
} from '@memory-os/observability';

const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/dr-restore-drill/m14-s04-v1',
);
const DEFAULT_OWNER_EXPORT_EVIDENCE_FILE = 'owner-export-metadata.json';
const MAX_FIXTURE_BYTES = 128 * 1024;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'body',
  'content',
  'memories',
  'payload',
  'token',
  'tokens',
  'exportpayload',
]);
const REQUIRED_RESTORE_CHECK_IDS = [
  'rows-present',
  'rls-after-restore',
  'checksum-verify',
  'embedding-index-rebuild',
  'provenance-sample',
] as const;

type RestoreCheckId = (typeof REQUIRED_RESTORE_CHECK_IDS)[number];

type DatabaseBackupManifest = {
  manifestVersion: string;
  contour: 'database';
  source: 'fixture-local';
  backupKind: 'daily' | 'pitr';
  pointInTimeRecovery: boolean;
  rpoMinutes: number | null;
  dailyRpoDocumented: boolean;
  includesArchivedStorageObjects: boolean;
};

type StorageArchiveManifest = {
  manifestVersion: string;
  contour: 'storage';
  source: 'fixture-local';
  storageMode: 'archived';
  versionedCopy: boolean;
  offsiteCopy: boolean;
  rpoHours: number;
  objectCount: number;
  checksumsVerified: boolean;
};

type RestoreCheck = {
  id: RestoreCheckId;
  ok: boolean;
  summary: string;
};

type RestoreVerificationSection = {
  ok: boolean;
};

type RestoreReportFixture = {
  reportVersion: string;
  restoreKind: 'production-like-fixture';
  source: 'fixture-local';
  rtoHours: number;
  rowsPresent: {
    memories: number;
    artifacts: number;
    auditEvents: number;
  };
  checks: RestoreCheck[];
  rlsVerification: RestoreVerificationSection & {
    matrixCases: string[];
  };
  checksumVerification: RestoreVerificationSection & {
    verifiedObjects: number;
    algorithms: string[];
  };
  embeddingIndexRebuild: RestoreVerificationSection & {
    rebuiltIndexIds: string[];
    rebuiltEmbeddings: number;
  };
  selectiveProvenance: RestoreVerificationSection & {
    sampleMemoryIds: string[];
    reproducibleFields: string[];
  };
  verifiedWritesCreated: number;
};

type OwnerExportEvidence = {
  format: 'memory-os.export.memories.v1';
  workspaceId: string;
  projectId: string;
  count: number;
  payloadStored: false;
  sampleMemoryIds: string[];
};

type RestoreCheckStatus = Record<RestoreCheckId, boolean>;

export const OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION = 'm14-s04-v1' as const;

export const OFFICIAL_M14_DR_RESTORE_RECIPE = {
  version: OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK.version,
  roadmapSections: OFFICIAL_M14_DR_RESTORE_DRILL_PACK.roadmapSections,
  targets: OFFICIAL_M14_DR_RESTORE_DRILL_PACK.targets.map((target) => target.id),
  bounds: {
    fixtureOnly: true,
    maxBackupContours: 2,
    maxOwnerExportEvidenceFiles: 1,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
  },
  invariants: {
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    requireIndependentBackupContours: true,
    requireExplicitProjectIdOnWriteOrExportInvocation: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRestore: false,
    allowProductionSqlApply: false,
    logPayloadBodies: false,
  },
} as const;

export type RestoreDrillConfigInput = {
  fixtureDir?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  exportEvidencePath?: string | null;
};

export type ResolvedRestoreDrillConfig = {
  fixtureDir: string;
  projectId: string | null;
  workspaceId: string;
  databaseManifestPath: string;
  storageManifestPath: string;
  restoreReportPath: string;
  exportEvidencePath: string | null;
};

export type RestoreDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION;
  config: Pick<ResolvedRestoreDrillConfig, 'fixtureDir' | 'projectId' | 'workspaceId'>;
  modeAToolCount: number;
  contours: {
    database: {
      manifestPath: string;
      backupKind: DatabaseBackupManifest['backupKind'];
      pointInTimeRecovery: boolean;
      rpoMinutes: number | null;
      dailyRpoDocumented: boolean;
      includesArchivedStorageObjects: boolean;
    };
    storage: {
      manifestPath: string;
      storageMode: StorageArchiveManifest['storageMode'];
      versionedCopy: boolean;
      offsiteCopy: boolean;
      rpoHours: number;
      objectCount: number;
      checksumsVerified: boolean;
    };
  };
  restore: {
    reportPath: string;
    rtoHours: number;
    rowsPresent: RestoreReportFixture['rowsPresent'];
    checkStatus: RestoreCheckStatus;
    exportEvidencePath: string | null;
    projectScopedOwnerExport: boolean;
    verifiedWritesCreated: number;
  };
  assertions: {
    ok: boolean;
    errors: string[];
  };
};

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFixturePath(pathValue: string | null | undefined): string {
  return resolve(trimToNull(pathValue) ?? DEFAULT_FIXTURE_DIR);
}

function readFixtureJson<T>(path: string, label: string): T {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
  const bytes = statSync(path).size;
  if (bytes > MAX_FIXTURE_BYTES) {
    throw new Error(`${label} exceeds bounded fixture size (${bytes} > ${MAX_FIXTURE_BYTES})`);
  }
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectForbiddenPayloadKeys(
  value: unknown,
  prefix = '',
  seen = new Set<unknown>(),
): string[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectForbiddenPayloadKeys(item, `${prefix}[${index}]`, seen),
    );
  }
  if (!isPlainObject(value)) return [];
  const violations: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const location = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.replace(/[^a-z]/gi, '').toLowerCase())) {
      violations.push(location);
    }
    violations.push(...collectForbiddenPayloadKeys(nested, location, seen));
  }
  return violations;
}

function emptyRestoreCheckStatus(): RestoreCheckStatus {
  return {
    'rows-present': false,
    'rls-after-restore': false,
    'checksum-verify': false,
    'embedding-index-rebuild': false,
    'provenance-sample': false,
  };
}

function projectScopedOwnerExport(
  config: ResolvedRestoreDrillConfig,
  evidence: OwnerExportEvidence | null,
): boolean {
  if (!evidence || !config.projectId) return false;
  return evidence.projectId === config.projectId;
}

export function resolveRestoreDrillConfig(
  input: RestoreDrillConfigInput,
): ResolvedRestoreDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const exportEvidenceOverride = trimToNull(input.exportEvidencePath);
  const exportEvidencePath = exportEvidenceOverride
    ? resolve(exportEvidenceOverride)
    : resolve(fixtureDir, DEFAULT_OWNER_EXPORT_EVIDENCE_FILE);
  const exportEvidenceExists = existsSync(exportEvidencePath);
  const projectId = trimToNull(input.projectId);

  if (exportEvidenceExists && !projectId) {
    throw new Error(
      'explicit project_id is required when owner export evidence is included; no default project fallback',
    );
  }

  return {
    fixtureDir,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
    databaseManifestPath: resolve(fixtureDir, 'db-backup-manifest.json'),
    storageManifestPath: resolve(fixtureDir, 'storage-archive-manifest.json'),
    restoreReportPath: resolve(fixtureDir, 'restore-report.json'),
    exportEvidencePath: exportEvidenceExists ? exportEvidencePath : null,
  };
}

export function restoreDrillConfigInputFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RestoreDrillConfigInput {
  return {
    fixtureDir: env.MEMORY_OS_DR_RESTORE_FIXTURE_DIR,
    projectId: env.MEMORY_OS_DR_RESTORE_PROJECT_ID ?? env.MEMORY_OS_PROJECT_ID,
    workspaceId: env.MEMORY_OS_WORKSPACE_ID ?? env.MEMORY_OS_DEFAULT_WORKSPACE_ID,
    exportEvidencePath: env.MEMORY_OS_DR_RESTORE_EXPORT_EVIDENCE_PATH,
  };
}

export function resolveRestoreDrillConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRestoreDrillConfig {
  return resolveRestoreDrillConfig(restoreDrillConfigInputFromEnv(env));
}

function buildRestoreDrillReport(input: {
  config: ResolvedRestoreDrillConfig;
  databaseManifest: DatabaseBackupManifest;
  storageManifest: StorageArchiveManifest;
  restoreReport: RestoreReportFixture;
  exportEvidence: OwnerExportEvidence | null;
}): RestoreDrillReport {
  const checkStatus = emptyRestoreCheckStatus();
  for (const check of input.restoreReport.checks) {
    checkStatus[check.id] = check.ok;
  }
  return {
    recipeVersion: OFFICIAL_M14_DR_RESTORE_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK.version,
    config: {
      fixtureDir: input.config.fixtureDir,
      projectId: input.config.projectId,
      workspaceId: input.config.workspaceId,
    },
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    contours: {
      database: {
        manifestPath: input.config.databaseManifestPath,
        backupKind: input.databaseManifest.backupKind,
        pointInTimeRecovery: input.databaseManifest.pointInTimeRecovery,
        rpoMinutes: input.databaseManifest.rpoMinutes,
        dailyRpoDocumented: input.databaseManifest.dailyRpoDocumented,
        includesArchivedStorageObjects:
          input.databaseManifest.includesArchivedStorageObjects,
      },
      storage: {
        manifestPath: input.config.storageManifestPath,
        storageMode: input.storageManifest.storageMode,
        versionedCopy: input.storageManifest.versionedCopy,
        offsiteCopy: input.storageManifest.offsiteCopy,
        rpoHours: input.storageManifest.rpoHours,
        objectCount: input.storageManifest.objectCount,
        checksumsVerified: input.storageManifest.checksumsVerified,
      },
    },
    restore: {
      reportPath: input.config.restoreReportPath,
      rtoHours: input.restoreReport.rtoHours,
      rowsPresent: input.restoreReport.rowsPresent,
      checkStatus,
      exportEvidencePath: input.config.exportEvidencePath,
      projectScopedOwnerExport: projectScopedOwnerExport(
        input.config,
        input.exportEvidence,
      ),
      verifiedWritesCreated: input.restoreReport.verifiedWritesCreated,
    },
    assertions: {
      ok: true,
      errors: [],
    },
  };
}

export function evaluateRestoreDrillReport(
  report: RestoreDrillReport,
  input: {
    databaseManifest: DatabaseBackupManifest;
    storageManifest: StorageArchiveManifest;
    restoreReport: RestoreReportFixture;
    exportEvidence: OwnerExportEvidence | null;
  },
): string[] {
  const errors: string[] = [];

  if (report.modeAToolCount !== CHATGPT_PILOT_TOOLS.length) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${CHATGPT_PILOT_TOOLS.length})`,
    );
  }

  if (input.databaseManifest.contour !== 'database') {
    errors.push('database backup contour manifest must declare contour=database');
  }
  if (input.storageManifest.contour !== 'storage') {
    errors.push('storage backup contour manifest must declare contour=storage');
  }
  if (input.databaseManifest.source !== 'fixture-local') {
    errors.push('database backup contour must stay local fixture-only');
  }
  if (input.storageManifest.source !== 'fixture-local') {
    errors.push('storage backup contour must stay local fixture-only');
  }
  if (input.databaseManifest.includesArchivedStorageObjects) {
    errors.push('database backup contour must not claim to restore archived Storage objects');
  }
  if (input.databaseManifest.pointInTimeRecovery) {
    if (
      input.databaseManifest.rpoMinutes === null ||
      input.databaseManifest.rpoMinutes >
        OFFICIAL_M14_DR_RESTORE_DRILL_PACK.invariants.maxDatabaseRpoMinutesWithPitr
    ) {
      errors.push('database PITR contour must stay at or below the 15 minute RPO target');
    }
  } else if (!input.databaseManifest.dailyRpoDocumented) {
    errors.push('database daily backup contour must document the daily RPO when PITR is absent');
  }

  if (input.storageManifest.storageMode !== 'archived') {
    errors.push('storage backup contour must stay in archived mode');
  }
  if (!input.storageManifest.versionedCopy || !input.storageManifest.offsiteCopy) {
    errors.push('storage backup contour must remain versioned and off-site');
  }
  if (
    input.storageManifest.rpoHours >
    OFFICIAL_M14_DR_RESTORE_DRILL_PACK.invariants.maxArchivedObjectRpoHours
  ) {
    errors.push('archived-object RPO exceeded the 24 hour beta target');
  }
  if (input.storageManifest.objectCount <= 0) {
    errors.push('storage backup contour must include at least one archived object fixture');
  }
  if (!input.storageManifest.checksumsVerified) {
    errors.push('storage backup contour must carry checksum verification evidence');
  }

  if (input.restoreReport.restoreKind !== 'production-like-fixture') {
    errors.push('restore report must stay bounded to a production-like local fixture');
  }
  if (input.restoreReport.source !== 'fixture-local') {
    errors.push('restore report must stay fixture-local');
  }
  if (
    input.restoreReport.rtoHours >
    OFFICIAL_M14_DR_RESTORE_DRILL_PACK.invariants.maxPrivateBetaRtoHours
  ) {
    errors.push('restore drill exceeded the private-beta RTO target');
  }
  if (
    input.restoreReport.rowsPresent.memories <= 0 ||
    input.restoreReport.rowsPresent.artifacts <= 0 ||
    input.restoreReport.rowsPresent.auditEvents <= 0
  ) {
    errors.push('restore drill must confirm restored rows for memories, artifacts, and audit events');
  }

  for (const checkId of REQUIRED_RESTORE_CHECK_IDS) {
    if (!report.restore.checkStatus[checkId]) {
      errors.push(`restore drill is missing required check: ${checkId}`);
    }
  }

  if (!input.restoreReport.rlsVerification.ok || input.restoreReport.rlsVerification.matrixCases.length === 0) {
    errors.push('restore drill must verify RLS deny cases after restore');
  }
  if (
    !input.restoreReport.checksumVerification.ok ||
    input.restoreReport.checksumVerification.verifiedObjects <= 0 ||
    input.restoreReport.checksumVerification.algorithms.length === 0
  ) {
    errors.push('restore drill must verify archived object checksums after restore');
  }
  if (
    !input.restoreReport.embeddingIndexRebuild.ok ||
    input.restoreReport.embeddingIndexRebuild.rebuiltIndexIds.length === 0 ||
    input.restoreReport.embeddingIndexRebuild.rebuiltEmbeddings <= 0
  ) {
    errors.push('restore drill must verify embedding/index rebuild after restore');
  }
  if (
    !input.restoreReport.selectiveProvenance.ok ||
    input.restoreReport.selectiveProvenance.sampleMemoryIds.length === 0 ||
    input.restoreReport.selectiveProvenance.reproducibleFields.length === 0
  ) {
    errors.push('restore drill must verify selective provenance reproducibility');
  }
  if (input.restoreReport.verifiedWritesCreated !== 0) {
    errors.push('restore drill must not create verified memory writes');
  }

  if (input.exportEvidence) {
    if (input.exportEvidence.format !== 'memory-os.export.memories.v1') {
      errors.push('owner export evidence must stay on memory-os.export.memories.v1');
    }
    if (input.exportEvidence.payloadStored !== false) {
      errors.push('owner export evidence must stay metadata-only');
    }
    if (input.exportEvidence.count <= 0) {
      errors.push('owner export evidence must include at least one exported record');
    }
    if (input.exportEvidence.sampleMemoryIds.length === 0) {
      errors.push('owner export evidence must include sampled memory ids');
    }
    if (report.config.projectId !== input.exportEvidence.projectId) {
      errors.push('owner export evidence must match the explicit project_id');
    }
    if (report.config.workspaceId !== input.exportEvidence.workspaceId) {
      errors.push('owner export evidence must stay in the requested workspace scope');
    }
    const forbiddenExportKeys = collectForbiddenPayloadKeys(input.exportEvidence);
    if (forbiddenExportKeys.length > 0) {
      errors.push(
        `owner export evidence must stay metadata-only (${forbiddenExportKeys.join(', ')})`,
      );
    }
    if (!report.restore.projectScopedOwnerExport) {
      errors.push('owner export evidence must stay project-scoped');
    }
  }

  return errors;
}

export function assertRestoreDrillReport(
  report: RestoreDrillReport,
  input: Parameters<typeof evaluateRestoreDrillReport>[1],
): void {
  const errors = evaluateRestoreDrillReport(report, input);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

export async function runRestoreDrillRecipe(
  input: RestoreDrillConfigInput,
): Promise<RestoreDrillReport> {
  const config = resolveRestoreDrillConfig(input);
  const databaseManifest = readFixtureJson<DatabaseBackupManifest>(
    config.databaseManifestPath,
    'database backup contour manifest',
  );
  const storageManifest = readFixtureJson<StorageArchiveManifest>(
    config.storageManifestPath,
    'storage backup contour manifest',
  );
  const restoreReport = readFixtureJson<RestoreReportFixture>(
    config.restoreReportPath,
    'restore drill report',
  );
  const exportEvidence = config.exportEvidencePath
    ? readFixtureJson<OwnerExportEvidence>(
        config.exportEvidencePath,
        'owner export evidence',
      )
    : null;

  const report = buildRestoreDrillReport({
    config,
    databaseManifest,
    storageManifest,
    restoreReport,
    exportEvidence,
  });
  const errors = evaluateRestoreDrillReport(report, {
    databaseManifest,
    storageManifest,
    restoreReport,
    exportEvidence,
  });
  report.assertions.ok = errors.length === 0;
  report.assertions.errors = errors;
  return report;
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
  OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
  OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
  OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  OFFICIAL_M14_SLO_PACK_VERSION,
  OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
} from '@memory-os/observability';
import { OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION, OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION, OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION, OFFICIAL_M15_CANONICALIZATION_PACK_VERSION, OFFICIAL_M15_FRESHNESS_PACK_VERSION, OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION, OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION, OFFICIAL_M15_OBSERVABILITY_PACK_VERSION } from '@memory-os/schemas';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
export const CURRENT_STATE_PATH = resolve(
  WORKSPACE_ROOT,
  'docs/engineering/CURRENT_STATE.json',
);

export const OFFICIAL_M14_1_BASELINE_MANIFEST_VERSION = 'm14.1-v1' as const;

export type CurrentStateManifest = {
  manifestVersion: string;
  schemaVersion: string;
  generatedAt: string;
  repository: string;
  canonicalProjectId: string;
  canonicalWorkspaceId: string;
  reconciledAgainstMainSha: string;
  currentMilestone: string;
  completedThrough: string;
  nextSlice: string;
  canonicalPlanMemoryTitle: string;
  supabase: {
    projectName: string;
    projectRef: string;
    region: string;
    latestMigration: string;
    migrationCount: number;
  };
  officialPacks: {
    m14Slo: string;
    m14SecurityReview: string;
    m14DrRestore: string;
    m14IncidentRunbooks: string;
    m14PrivacySla: string;
    m14DependencyUpgrade: string;
    m14GaDocCatalog: string;
    m14FirstHourOnboarding: string;
    m14SupportOps: string;
    m15SourceEventContract: string;
    m15ConnectorOrchestration: string;
    m15ProjectRouting: string;
    m15Canonicalization: string;
    m15Freshness: string;
    m15DeletionRevoke: string;
    m15CapturePolicy: string;
    m15Observability: string;
  };
  deployments: {
    flyApi: {
      status: string;
      appName: string;
      configPath: string;
      note: string;
    };
    edgeFunctions: string[];
    githubActions: string[];
  };
  workers: string[];
  connectors: string[];
  chatgptModeA: {
    status: string;
    passedAt: string;
    toolCount: number;
    transport: string;
  };
  projectRouting: {
    allowMemoryOsDefaultProjectIdFallback: boolean;
    allowAistroykaFallback: boolean;
    writesRequireExplicitProjectId: boolean;
  };
  tests: {
    rootVitestInclude: string;
    goldenRetrievalHarness: string;
    m14PackTestsGlob: string;
  };
  openPrPolicy: Record<
    string,
    {
      number: number;
      disposition: string;
      rationale: string;
    }
  >;
  knownBlockers: Array<{
    id: string;
    severity: string;
    summary: string;
  }>;
  readmeMustContain: string[];
  readmeMustNotClaimAsCurrentTip: string[];
};

export type CurrentStateDriftFinding = {
  code: string;
  message: string;
};

export type CurrentStateDriftReport = {
  ok: boolean;
  manifestPath: string;
  findings: CurrentStateDriftFinding[];
};

const SHA_RE = /^[0-9a-f]{40}$/i;
const FORBIDDEN_DEFAULT_PROJECT_ENV_READ =
  /process\.env\.MEMORY_OS_DEFAULT_PROJECT_ID|env\.MEMORY_OS_DEFAULT_PROJECT_ID/;

function readJsonManifest(path: string): CurrentStateManifest {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as CurrentStateManifest;
}

function listDirNames(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort();
}

function listFileNames(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function scanSourceForDefaultProjectEnvReads(root: string): string[] {
  const hits: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
      if (/\.test\.(ts|tsx|js)$/.test(entry.name)) continue;
      const text = readFileSync(full, 'utf8');
      if (FORBIDDEN_DEFAULT_PROJECT_ENV_READ.test(text)) {
        hits.push(full.replace(`${WORKSPACE_ROOT}/`, ''));
      }
    }
  }
  return hits.sort();
}

/**
 * Fail-closed drift check for M14.1 CURRENT_STATE vs repo reality.
 * Mechanical only — does not call live APIs or mutate production.
 */
export function validateCurrentStateDrift(
  workspaceRoot: string = WORKSPACE_ROOT,
): CurrentStateDriftReport {
  const findings: CurrentStateDriftFinding[] = [];
  const manifestPath = resolve(workspaceRoot, 'docs/engineering/CURRENT_STATE.json');

  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      manifestPath,
      findings: [
        {
          code: 'missing-current-state',
          message: `missing ${manifestPath}`,
        },
      ],
    };
  }

  let manifest: CurrentStateManifest;
  try {
    manifest = readJsonManifest(manifestPath);
  } catch (error) {
    return {
      ok: false,
      manifestPath,
      findings: [
        {
          code: 'invalid-json',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  if (manifest.manifestVersion !== OFFICIAL_M14_1_BASELINE_MANIFEST_VERSION) {
    findings.push({
      code: 'manifest-version',
      message: `expected manifestVersion ${OFFICIAL_M14_1_BASELINE_MANIFEST_VERSION}, got ${manifest.manifestVersion}`,
    });
  }

  if (!SHA_RE.test(manifest.reconciledAgainstMainSha)) {
    findings.push({
      code: 'main-sha',
      message: 'reconciledAgainstMainSha must be a 40-char lowercase/hex git SHA',
    });
  }

  if (manifest.currentMilestone !== 'M15.8-observability-slos') {
    findings.push({
      code: 'current-milestone',
      message: `expected currentMilestone M15.8-observability-slos, got ${manifest.currentMilestone}`,
    });
  }

  if (manifest.completedThrough !== 'M15.8') {
    findings.push({
      code: 'completed-through',
      message: `expected completedThrough M15.8 after observability pack, got ${manifest.completedThrough}`,
    });
  }

  if (manifest.nextSlice !== 'M15-live-e2e-closure') {
    findings.push({
      code: 'next-slice',
      message: `expected nextSlice M15-live-e2e-closure, got ${manifest.nextSlice}`,
    });
  }

  const expectedPacks: Record<keyof CurrentStateManifest['officialPacks'], string> =
    {
      m14Slo: OFFICIAL_M14_SLO_PACK_VERSION,
      m14SecurityReview: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
      m14DrRestore: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
      m14IncidentRunbooks: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
      m14PrivacySla: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
      m14DependencyUpgrade: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
      m14GaDocCatalog: OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
      m14FirstHourOnboarding: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
      m14SupportOps: OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
      m15SourceEventContract: OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION,
      m15ConnectorOrchestration: OFFICIAL_M15_CONNECTOR_ORCHESTRATION_PACK_VERSION,
      m15ProjectRouting: OFFICIAL_M15_PROJECT_ROUTING_PACK_VERSION,
      m15Canonicalization: OFFICIAL_M15_CANONICALIZATION_PACK_VERSION,
      m15Freshness: OFFICIAL_M15_FRESHNESS_PACK_VERSION,
      m15DeletionRevoke: OFFICIAL_M15_DELETION_REVOKE_PACK_VERSION,
      m15CapturePolicy: OFFICIAL_M15_CAPTURE_POLICY_PACK_VERSION,
      m15Observability: OFFICIAL_M15_OBSERVABILITY_PACK_VERSION,
    };

  for (const [key, expected] of Object.entries(expectedPacks) as Array<
    [keyof CurrentStateManifest['officialPacks'], string]
  >) {
    if (manifest.officialPacks[key] !== expected) {
      findings.push({
        code: `pack-${key}`,
        message: `officialPacks.${key} expected ${expected}, got ${manifest.officialPacks[key]}`,
      });
    }
  }

  const migrationPath = resolve(
    workspaceRoot,
    'supabase/migrations',
    manifest.supabase.latestMigration,
  );
  if (!existsSync(migrationPath)) {
    findings.push({
      code: 'latest-migration-missing',
      message: `latestMigration file missing: ${manifest.supabase.latestMigration}`,
    });
  }

  const migrationFiles = listFileNames(
    resolve(workspaceRoot, 'supabase/migrations'),
  ).filter((name) => name.endsWith('.sql'));
  if (migrationFiles.length !== manifest.supabase.migrationCount) {
    findings.push({
      code: 'migration-count',
      message: `migrationCount expected ${manifest.supabase.migrationCount}, found ${migrationFiles.length}`,
    });
  }
  const tipMigration = migrationFiles[migrationFiles.length - 1];
  if (tipMigration && tipMigration !== manifest.supabase.latestMigration) {
    findings.push({
      code: 'migration-tip-drift',
      message: `latestMigration ${manifest.supabase.latestMigration} is not tip ${tipMigration}`,
    });
  }

  for (const name of manifest.deployments.edgeFunctions) {
    if (!existsSync(resolve(workspaceRoot, 'supabase/functions', name))) {
      findings.push({
        code: 'edge-function-missing',
        message: `edge function directory missing: ${name}`,
      });
    }
  }

  for (const name of manifest.deployments.githubActions) {
    if (!existsSync(resolve(workspaceRoot, '.github/workflows', name))) {
      findings.push({
        code: 'workflow-missing',
        message: `workflow missing: ${name}`,
      });
    }
  }

  if (!existsSync(resolve(workspaceRoot, manifest.deployments.flyApi.configPath))) {
    findings.push({
      code: 'fly-toml-missing',
      message: `fly config missing: ${manifest.deployments.flyApi.configPath}`,
    });
  }

  const workerDirs = listDirNames(resolve(workspaceRoot, 'workers'));
  for (const name of manifest.workers) {
    if (!workerDirs.includes(name)) {
      findings.push({
        code: 'worker-missing',
        message: `worker directory missing: ${name}`,
      });
    }
  }

  const connectorDirs = listDirNames(resolve(workspaceRoot, 'connectors'));
  for (const name of manifest.connectors) {
    if (!connectorDirs.includes(name)) {
      findings.push({
        code: 'connector-missing',
        message: `connector directory missing: ${name}`,
      });
    }
  }

  if (!existsSync(resolve(workspaceRoot, manifest.tests.goldenRetrievalHarness))) {
    findings.push({
      code: 'golden-harness-missing',
      message: `golden retrieval harness missing: ${manifest.tests.goldenRetrievalHarness}`,
    });
  }

  if (manifest.projectRouting.allowMemoryOsDefaultProjectIdFallback !== false) {
    findings.push({
      code: 'default-project-fallback-flag',
      message: 'allowMemoryOsDefaultProjectIdFallback must be false',
    });
  }
  if (manifest.projectRouting.allowAistroykaFallback !== false) {
    findings.push({
      code: 'aistroyka-fallback-flag',
      message: 'allowAistroykaFallback must be false',
    });
  }
  if (manifest.projectRouting.writesRequireExplicitProjectId !== true) {
    findings.push({
      code: 'explicit-project-required-flag',
      message: 'writesRequireExplicitProjectId must be true',
    });
  }

  if (manifest.chatgptModeA.toolCount !== 7 || manifest.chatgptModeA.status !== 'PASS') {
    findings.push({
      code: 'chatgpt-mode-a',
      message: 'chatgptModeA must remain PASS with exactly 7 tools',
    });
  }

  const readmePath = resolve(workspaceRoot, 'README.md');
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  if (!readme) {
    findings.push({ code: 'readme-missing', message: 'README.md missing' });
  } else {
    for (const snippet of manifest.readmeMustContain) {
      if (!readme.includes(snippet)) {
        findings.push({
          code: 'readme-missing-snippet',
          message: `README.md must contain: ${snippet}`,
        });
      }
    }
    for (const snippet of manifest.readmeMustNotClaimAsCurrentTip) {
      if (readme.includes(snippet)) {
        findings.push({
          code: 'readme-stale-tip',
          message: `README.md still claims obsolete tip wording: ${snippet}`,
        });
      }
    }
  }

  const envReadHits = [
    ...scanSourceForDefaultProjectEnvReads(resolve(workspaceRoot, 'apps')),
    ...scanSourceForDefaultProjectEnvReads(resolve(workspaceRoot, 'packages')),
    ...scanSourceForDefaultProjectEnvReads(resolve(workspaceRoot, 'workers')),
    ...scanSourceForDefaultProjectEnvReads(resolve(workspaceRoot, 'connectors')),
  ];
  for (const hit of envReadHits) {
    findings.push({
      code: 'default-project-env-read',
      message: `runtime source reads MEMORY_OS_DEFAULT_PROJECT_ID: ${hit}`,
    });
  }

  const stalePr = manifest.openPrPolicy.staleDraftPr16;
  if (!stalePr || stalePr.number !== 16 || !stalePr.disposition.includes('close')) {
    findings.push({
      code: 'pr16-policy',
      message: 'openPrPolicy.staleDraftPr16 must close/supersede draft PR #16',
    });
  }

  return {
    ok: findings.length === 0,
    manifestPath,
    findings,
  };
}

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHATGPT_PILOT_TOOLS, DEFAULT_WORKSPACE_ID } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_INCIDENT_RUNBOOK_PACK,
  OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/incident-runbooks/m14-s05-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;
const TELEMETRY_HYGIENE_SNIPPET =
  'Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.';
const SUSPICIOUS_DOC_PATTERNS = [
  {
    label: 'bearer-token-example',
    pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  },
  {
    label: 'authorization-header-example',
    pattern:
      /authorization\s*:\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
  {
    label: 'token-json-example',
    pattern:
      /"(?:access_token|refresh_token|token|authorization|cookie)"\s*:\s*"[^"]+"/i,
  },
  {
    label: 'payload-json-example',
    pattern: /"(?:payload|body|content|memories)"\s*:\s*(?:\{|\[|")/i,
  },
  {
    label: 'secret-assignment-example',
    pattern:
      /\b(?:service_role|vault_key|refresh_token|access_token)\s*=\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
] as const;

type IncidentRunbookId =
  (typeof OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks)[number]['id'];
type IncidentAlertId = (typeof OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts)[number]['id'];
type IncidentRunbookOwnerRole =
  (typeof OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks)[number]['ownerRole'];

type ManifestAlert = {
  id: IncidentAlertId;
  owner: IncidentRunbookOwnerRole;
  runbookId: IncidentRunbookId;
};

type ManifestRunbook = {
  id: IncidentRunbookId;
  title: string;
  owner: IncidentRunbookOwnerRole;
  docPath: string;
  alertIds: IncidentAlertId[];
  writeAdminPaths: string[];
  explicitProjectIdRequired: boolean;
};

type IncidentRunbookManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  alerts: ManifestAlert[];
  runbooks: ManifestRunbook[];
};

type ResolvedRunbookDoc = {
  manifestRunbook: ManifestRunbook;
  resolvedDocPath: string;
  docExists: boolean;
  ownerLine: string | null;
  hasRollbackOrRevokeStep: boolean;
  hasTelemetryHygieneSection: boolean;
  hasExplicitProjectIdNote: boolean;
  coveredAlertsPresent: boolean;
  suspiciousExampleLabels: string[];
  missingSnippets: string[];
};

export const OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION = 'm14-s05-v1' as const;

export const OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE = {
  version: OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version,
  roadmapSections: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.roadmapSections,
  runbooks: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.map((runbook) => runbook.id),
  alerts: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.map((alert) => alert.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxRunbooks: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.length,
    maxAlerts: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.length,
  },
  invariants: {
    modeAToolCount: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants.modeAToolCount,
    requireRunbookOwner: true,
    requireRollbackOrRevokeStep: true,
    requireExplicitProjectIdOnAdminOrRevokeInvocation: true,
    requireAlertOwner: true,
    requireAlertRunbook: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRevoke: false,
    allowLiveRollback: false,
    allowProductionSqlApply: false,
    logPayloadBodies: false,
  },
} as const;

export type IncidentRunbookDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedIncidentRunbookDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type IncidentRunbookDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION;
  config: Pick<
    ResolvedIncidentRunbookDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  modeAToolCount: number;
  alerts: {
    totalExpected: number;
    mappedCount: number;
    missingIds: IncidentAlertId[];
    ownerlessIds: IncidentAlertId[];
    runbooklessIds: IncidentAlertId[];
  };
  runbooks: Array<{
    id: IncidentRunbookId;
    owner: IncidentRunbookOwnerRole;
    docPath: string;
    coveredAlertIds: IncidentAlertId[];
    writeAdminPaths: string[];
    explicitProjectIdRequired: boolean;
    docExists: boolean;
    ownerLine: string | null;
    hasRollbackOrRevokeStep: boolean;
    hasTelemetryHygieneSection: boolean;
    hasExplicitProjectIdNote: boolean;
    coveredAlertsPresent: boolean;
    suspiciousExampleLabels: string[];
    missingSnippets: string[];
  }>;
  writeActionsAttempted: 0;
  verifiedWritesAttempted: 0;
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

function readBoundedText(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
  const bytes = statSync(path).size;
  if (bytes > MAX_FIXTURE_BYTES) {
    throw new Error(`${label} exceeds bounded fixture size (${bytes} > ${MAX_FIXTURE_BYTES})`);
  }
  return readFileSync(path, 'utf8');
}

function readFixtureJson<T>(path: string, label: string): T {
  return JSON.parse(readBoundedText(path, label)) as T;
}

function resolveDocPath(pathValue: string): string {
  return pathValue.startsWith('/') ? pathValue : resolve(WORKSPACE_ROOT, pathValue);
}

function extractOwnerLine(doc: string): string | null {
  const match = doc.match(/^Owner:[ \t]*(.+)$/m);
  const owner = match?.[1]?.trim();
  return owner && owner.length > 0 ? owner : null;
}

function getSectionBody(doc: string, heading: string): string | null {
  const lines = doc.split('\n');
  const normalizedHeading = heading.trim().toLowerCase();
  const startIndex = lines.findIndex((line) => {
    return line.trim().toLowerCase() === `## ${normalizedHeading}`;
  });
  if (startIndex < 0) return null;
  const body: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body.join('\n').trim();
}

function hasRollbackOrRevokeStep(doc: string): boolean {
  const section = getSectionBody(doc, 'Rollback / revoke');
  return Boolean(
    section &&
      /(?:^- |\n- |\n\d+\.)/m.test(section) &&
      /\b(?:rollback|revoke)\b/i.test(section),
  );
}

function hasTelemetryHygieneSection(doc: string): boolean {
  const section = getSectionBody(doc, 'Telemetry hygiene');
  return Boolean(section && section.includes(TELEMETRY_HYGIENE_SNIPPET));
}

function hasExplicitProjectIdNote(doc: string): boolean {
  return /explicit\s+`?project_id`?/i.test(doc);
}

function suspiciousExampleLabels(doc: string): string[] {
  return SUSPICIOUS_DOC_PATTERNS.flatMap(({ label, pattern }) =>
    pattern.test(doc) ? [label] : [],
  );
}

function missingSnippets(
  doc: string,
  expectedSnippets: readonly string[],
): string[] {
  const normalizedDoc = doc.toLowerCase();
  return expectedSnippets.filter(
    (snippet) => !normalizedDoc.includes(snippet.toLowerCase()),
  );
}

function buildRunbookSummary(
  manifestRunbook: ManifestRunbook,
): ResolvedRunbookDoc {
  const resolvedDocPath = resolveDocPath(manifestRunbook.docPath);
  if (!existsSync(resolvedDocPath)) {
    return {
      manifestRunbook,
      resolvedDocPath,
      docExists: false,
      ownerLine: null,
      hasRollbackOrRevokeStep: false,
      hasTelemetryHygieneSection: false,
      hasExplicitProjectIdNote: false,
      coveredAlertsPresent: false,
      suspiciousExampleLabels: [],
      missingSnippets: [],
    };
  }

  const doc = readBoundedText(resolvedDocPath, `incident runbook ${manifestRunbook.id}`);
  const expected = OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.find(
    (runbook) => runbook.id === manifestRunbook.id,
  );
  return {
    manifestRunbook,
    resolvedDocPath,
    docExists: true,
    ownerLine: extractOwnerLine(doc),
    hasRollbackOrRevokeStep: hasRollbackOrRevokeStep(doc),
    hasTelemetryHygieneSection: hasTelemetryHygieneSection(doc),
    hasExplicitProjectIdNote: hasExplicitProjectIdNote(doc),
    coveredAlertsPresent: manifestRunbook.alertIds.every((alertId) =>
      doc.includes(alertId),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(doc),
    missingSnippets: expected ? missingSnippets(doc, expected.requiredSnippets) : [],
  };
}

export function resolveIncidentRunbookDrillConfig(
  input: IncidentRunbookDrillConfigInput,
): ResolvedIncidentRunbookDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    trimToNull(input.manifestPath) ?? resolve(fixtureDir, 'runbook-manifest.json'),
  );
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the incident runbook drill; no default project fallback',
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function incidentRunbookDrillConfigInputFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): IncidentRunbookDrillConfigInput {
  return {
    fixtureDir: env.MEMORY_OS_INCIDENT_RUNBOOK_FIXTURE_DIR,
    manifestPath: env.MEMORY_OS_INCIDENT_RUNBOOK_MANIFEST_PATH,
    projectId:
      env.MEMORY_OS_INCIDENT_RUNBOOK_PROJECT_ID ?? env.MEMORY_OS_PROJECT_ID,
    workspaceId: env.MEMORY_OS_WORKSPACE_ID ?? env.MEMORY_OS_DEFAULT_WORKSPACE_ID,
  };
}

export function resolveIncidentRunbookDrillConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedIncidentRunbookDrillConfig {
  return resolveIncidentRunbookDrillConfig(
    incidentRunbookDrillConfigInputFromEnv(env),
  );
}

function buildIncidentRunbookDrillReport(input: {
  config: ResolvedIncidentRunbookDrillConfig;
  manifest: IncidentRunbookManifest;
  runbookDocs: ResolvedRunbookDoc[];
}): IncidentRunbookDrillReport {
  const expectedAlertIds = OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.map(
    (alert) => alert.id,
  );
  const mappedAlerts = input.manifest.alerts.filter(
    (alert) => alert.owner.trim().length > 0 && alert.runbookId.trim().length > 0,
  );
  const ownerlessIds = input.manifest.alerts
    .filter((alert) => alert.owner.trim().length === 0)
    .map((alert) => alert.id);
  const runbooklessIds = input.manifest.alerts
    .filter((alert) => alert.runbookId.trim().length === 0)
    .map((alert) => alert.id);
  const presentAlertIds = new Set(input.manifest.alerts.map((alert) => alert.id));
  const missingIds = expectedAlertIds.filter((alertId) => !presentAlertIds.has(alertId));

  return {
    recipeVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version,
    config: {
      fixtureDir: input.config.fixtureDir,
      manifestPath: input.config.manifestPath,
      projectId: input.config.projectId,
      workspaceId: input.config.workspaceId,
    },
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    alerts: {
      totalExpected: expectedAlertIds.length,
      mappedCount: mappedAlerts.length,
      missingIds,
      ownerlessIds,
      runbooklessIds,
    },
    runbooks: input.runbookDocs.map((runbookDoc) => ({
      id: runbookDoc.manifestRunbook.id,
      owner: runbookDoc.manifestRunbook.owner,
      docPath: runbookDoc.resolvedDocPath,
      coveredAlertIds: runbookDoc.manifestRunbook.alertIds,
      writeAdminPaths: runbookDoc.manifestRunbook.writeAdminPaths,
      explicitProjectIdRequired: runbookDoc.manifestRunbook.explicitProjectIdRequired,
      docExists: runbookDoc.docExists,
      ownerLine: runbookDoc.ownerLine,
      hasRollbackOrRevokeStep: runbookDoc.hasRollbackOrRevokeStep,
      hasTelemetryHygieneSection: runbookDoc.hasTelemetryHygieneSection,
      hasExplicitProjectIdNote: runbookDoc.hasExplicitProjectIdNote,
      coveredAlertsPresent: runbookDoc.coveredAlertsPresent,
      suspiciousExampleLabels: runbookDoc.suspiciousExampleLabels,
      missingSnippets: runbookDoc.missingSnippets,
    })),
    writeActionsAttempted: 0,
    verifiedWritesAttempted: 0,
    assertions: {
      ok: true,
      errors: [],
    },
  };
}

export function evaluateIncidentRunbookDrillReport(
  report: IncidentRunbookDrillReport,
  input: {
    manifest: IncidentRunbookManifest;
  },
): string[] {
  const errors: string[] = [];
  const expectedRunbooks = new Map(
    OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.map((runbook) => [runbook.id, runbook]),
  );
  const expectedAlerts = new Map(
    OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.map((alert) => [alert.id, alert]),
  );
  const manifestRunbooks = new Map(input.manifest.runbooks.map((runbook) => [runbook.id, runbook]));
  const manifestAlerts = new Map(input.manifest.alerts.map((alert) => [alert.id, alert]));

  if (
    report.modeAToolCount !==
    OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants.modeAToolCount
  ) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants.modeAToolCount})`,
    );
  }
  if (report.writeActionsAttempted !== 0) {
    errors.push('incident runbook drill must not execute live write/admin/revoke actions');
  }
  if (report.verifiedWritesAttempted !== 0) {
    errors.push('incident runbook drill must not attempt verified memory writes');
  }
  if (
    input.manifest.manifestVersion !== OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION
  ) {
    errors.push(
      `incident runbook manifest version drifted (${input.manifest.manifestVersion} !== ${OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION})`,
    );
  }
  if (input.manifest.packVersion !== OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version) {
    errors.push(
      `incident runbook manifest must stay pinned to ${OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version}`,
    );
  }
  if (input.manifest.source !== 'fixture-local') {
    errors.push('incident runbook manifest must stay fixture-local');
  }
  if (
    JSON.stringify(input.manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.roadmapSections)
  ) {
    errors.push('incident runbook manifest roadmap sections drifted from the official pack');
  }

  for (const [runbookId, expected] of expectedRunbooks) {
    const manifestRunbook = manifestRunbooks.get(runbookId);
    if (!manifestRunbook) {
      errors.push(`incident runbook manifest is missing required runbook: ${runbookId}`);
      continue;
    }
    if (manifestRunbook.owner !== expected.ownerRole) {
      errors.push(
        `incident runbook ${runbookId} owner mismatch (${manifestRunbook.owner} !== ${expected.ownerRole})`,
      );
    }
    const reportRunbook = report.runbooks.find((runbook) => runbook.id === runbookId);
    if (!reportRunbook?.docExists) {
      errors.push(`incident runbook document is missing for ${runbookId}`);
      continue;
    }
    if (!reportRunbook.ownerLine) {
      errors.push(`incident runbook ${runbookId} is missing an Owner line`);
    } else if (reportRunbook.ownerLine !== expected.ownerRole) {
      errors.push(
        `incident runbook ${runbookId} owner line mismatch (${reportRunbook.ownerLine} !== ${expected.ownerRole})`,
      );
    }
    if (!reportRunbook.hasRollbackOrRevokeStep) {
      errors.push(`incident runbook ${runbookId} is missing a rollback/revoke step`);
    }
    if (!reportRunbook.hasTelemetryHygieneSection) {
      errors.push(`incident runbook ${runbookId} is missing telemetry hygiene guidance`);
    }
    if (!reportRunbook.hasExplicitProjectIdNote) {
      errors.push(`incident runbook ${runbookId} must require explicit project_id`);
    }
    if (!reportRunbook.coveredAlertsPresent) {
      errors.push(`incident runbook ${runbookId} must list each alert it covers`);
    }
    if (
      reportRunbook.writeAdminPaths.length > 0 &&
      !reportRunbook.explicitProjectIdRequired
    ) {
      errors.push(
        `incident runbook ${runbookId} must require explicit project_id for admin/revoke paths`,
      );
    }
    if (reportRunbook.suspiciousExampleLabels.length > 0) {
      errors.push(
        `incident runbook ${runbookId} leaks sensitive examples (${reportRunbook.suspiciousExampleLabels.join(', ')})`,
      );
    }
    if (reportRunbook.missingSnippets.length > 0) {
      errors.push(
        `incident runbook ${runbookId} is missing required guidance (${reportRunbook.missingSnippets.join(', ')})`,
      );
    }
  }

  for (const [alertId, expected] of expectedAlerts) {
    const manifestAlert = manifestAlerts.get(alertId);
    if (!manifestAlert) {
      errors.push(`incident alert mapping is missing required alert: ${alertId}`);
      continue;
    }
    if (manifestAlert.owner !== expected.ownerRole) {
      errors.push(
        `incident alert ${alertId} owner mismatch (${manifestAlert.owner} !== ${expected.ownerRole})`,
      );
    }
    if (manifestAlert.runbookId !== expected.runbookId) {
      errors.push(
        `incident alert ${alertId} runbook mismatch (${manifestAlert.runbookId} !== ${expected.runbookId})`,
      );
    }
  }

  return errors;
}

export async function runIncidentRunbookDrill(
  input: IncidentRunbookDrillConfigInput,
): Promise<IncidentRunbookDrillReport> {
  const config = resolveIncidentRunbookDrillConfig(input);
  const manifest = readFixtureJson<IncidentRunbookManifest>(
    config.manifestPath,
    'incident runbook manifest',
  );
  const runbookDocs = manifest.runbooks.map((runbook) => buildRunbookSummary(runbook));
  const report = buildIncidentRunbookDrillReport({
    config,
    manifest,
    runbookDocs,
  });
  const errors = evaluateIncidentRunbookDrillReport(report, { manifest });
  report.assertions.ok = errors.length === 0;
  report.assertions.errors = errors;
  return report;
}

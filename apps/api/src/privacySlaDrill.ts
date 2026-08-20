import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHATGPT_PILOT_TOOLS, DEFAULT_WORKSPACE_ID } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_PRIVACY_SLA_PACK,
  OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/privacy-sla/m14-s06-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;
const TELEMETRY_HYGIENE_SNIPPET =
  'Do not log memory bodies, export payloads, privacy request free-text reasons, correction text, or tokens.';
const REQUIRED_CONNECTOR_FAMILIES = [
  'GitHub',
  'Google Drive',
  'Gmail',
  'Google Calendar',
  'Apple transferred objects',
] as const;
const REQUIRED_REUSE_SURFACES = [
  'workers/connector-sync/src/index.ts',
  'apps/web/src/TransferredObjectsPage.tsx',
] as const;
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
    pattern: /"(?:payload|body|content|memories|correction_text)"\s*:\s*(?:\{|\[|")/i,
  },
  {
    label: 'privacy-reason-example',
    pattern:
      /"reason"\s*:\s*"(?!\[REDACTED\]|<redacted>|<reason>|redacted\b)[^"]+"/i,
  },
  {
    label: 'secret-assignment-example',
    pattern:
      /\b(?:service_role|vault_key|refresh_token|access_token)\s*=\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
] as const;

type PrivacySlaPathId =
  (typeof OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths)[number]['id'];

type PrivacySlaManifestPath = {
  id: PrivacySlaPathId;
  title: string;
  route: string;
  requestType?: 'deletion' | 'correction' | 'retraction' | null;
  owner: string;
  deadline: string;
  docPath: string;
  sectionHeading: string;
  explicitProjectIdRequired: boolean;
  metadataOnlyAudit: boolean;
  connectorDerivedCoverage: boolean;
};

type PrivacySlaCoverageSpec = {
  docPath: string;
  sectionHeading: string;
  connectorFamilies: string[];
  reuseSurfaces: string[];
};

type PrivacySlaTelemetrySpec = {
  docPath: string;
  sectionHeading: string;
  snippet: string;
};

type PrivacySlaManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  slaPaths: PrivacySlaManifestPath[];
  connectorCoverage: PrivacySlaCoverageSpec;
  telemetryHygiene: PrivacySlaTelemetrySpec;
};

type ResolvedSlaSection = {
  manifestPath: PrivacySlaManifestPath;
  resolvedDocPath: string;
  docExists: boolean;
  routeMatches: boolean;
  ownerLine: string | null;
  deadlineLine: string | null;
  hasExplicitProjectIdNote: boolean;
  hasMetadataOnlyAuditNote: boolean;
  hasConnectorDerivedCoverageNote: boolean;
  suspiciousExampleLabels: string[];
};

type ConnectorCoverageSummary = {
  docPath: string;
  sectionExists: boolean;
  connectorFamiliesPresent: string[];
  missingConnectorFamilies: string[];
  reuseSurfacesPresent: string[];
  missingReuseSurfaces: string[];
};

type TelemetryHygieneSummary = {
  docPath: string;
  sectionExists: boolean;
  snippetPresent: boolean;
  suspiciousExampleLabels: string[];
};

export const OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION = 'm14-s06-v1' as const;

export const OFFICIAL_M14_PRIVACY_SLA_RECIPE = {
  version: OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_PRIVACY_SLA_PACK.version,
  roadmapSections: OFFICIAL_M14_PRIVACY_SLA_PACK.roadmapSections,
  slaPaths: OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.map((path) => path.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxSlaPaths: OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.length,
  },
  invariants: {
    modeAToolCount: OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount,
    requireSlaOwner: true,
    requireSlaDeadline: true,
    requireConnectorDerivedCoverage: true,
    requireCorrectionRetractionCoverage: true,
    requireExplicitProjectIdOnExportOrDeleteInvocation: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveExport: false,
    allowLiveDelete: false,
    allowProductionSqlApply: false,
    logPayloadBodies: false,
  },
} as const;

export type PrivacySlaDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedPrivacySlaDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type PrivacySlaDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION;
  config: Pick<
    ResolvedPrivacySlaDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  modeAToolCount: number;
  slaPaths: Array<{
    id: PrivacySlaPathId;
    route: string;
    requestType: 'deletion' | 'correction' | 'retraction' | null;
    owner: string;
    deadline: string;
    docPath: string;
    explicitProjectIdRequired: boolean;
    metadataOnlyAudit: boolean;
    connectorDerivedCoverage: boolean;
    docExists: boolean;
    routeMatches: boolean;
    ownerLine: string | null;
    deadlineLine: string | null;
    hasExplicitProjectIdNote: boolean;
    hasMetadataOnlyAuditNote: boolean;
    hasConnectorDerivedCoverageNote: boolean;
    suspiciousExampleLabels: string[];
  }>;
  connectorCoverage: ConnectorCoverageSummary;
  telemetryHygiene: TelemetryHygieneSummary;
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

function extractFieldLine(section: string, label: string): string | null {
  const pattern = new RegExp(`^${label}:[ \\t]*(.+)$`, 'mi');
  const match = section.match(pattern);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

function suspiciousExampleLabels(doc: string): string[] {
  return SUSPICIOUS_DOC_PATTERNS.flatMap(({ label, pattern }) =>
    pattern.test(doc) ? [label] : [],
  );
}

function hasExplicitProjectIdNote(section: string): boolean {
  return /explicit\s+`?project_id`?/i.test(section);
}

function hasMetadataOnlyAuditNote(section: string): boolean {
  return /metadata-only audit/i.test(section);
}

function hasConnectorDerivedCoverageNote(section: string): boolean {
  return /connector-derived/i.test(section);
}

function buildSlaSectionSummary(
  manifestPath: PrivacySlaManifestPath,
): ResolvedSlaSection {
  const resolvedDocPath = resolveDocPath(manifestPath.docPath);
  if (!existsSync(resolvedDocPath)) {
    return {
      manifestPath,
      resolvedDocPath,
      docExists: false,
      routeMatches: false,
      ownerLine: null,
      deadlineLine: null,
      hasExplicitProjectIdNote: false,
      hasMetadataOnlyAuditNote: false,
      hasConnectorDerivedCoverageNote: false,
      suspiciousExampleLabels: [],
    };
  }

  const doc = readBoundedText(resolvedDocPath, `privacy SLA doc for ${manifestPath.id}`);
  const section = getSectionBody(doc, manifestPath.sectionHeading) ?? '';
  return {
    manifestPath,
    resolvedDocPath,
    docExists: true,
    routeMatches: section.includes(manifestPath.route),
    ownerLine: extractFieldLine(section, 'Owner'),
    deadlineLine: extractFieldLine(section, 'Deadline'),
    hasExplicitProjectIdNote: hasExplicitProjectIdNote(section),
    hasMetadataOnlyAuditNote: hasMetadataOnlyAuditNote(section),
    hasConnectorDerivedCoverageNote: hasConnectorDerivedCoverageNote(section),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

function buildConnectorCoverageSummary(
  spec: PrivacySlaCoverageSpec,
): ConnectorCoverageSummary {
  const resolvedDocPath = resolveDocPath(spec.docPath);
  if (!existsSync(resolvedDocPath)) {
    return {
      docPath: resolvedDocPath,
      sectionExists: false,
      connectorFamiliesPresent: [],
      missingConnectorFamilies: [...spec.connectorFamilies],
      reuseSurfacesPresent: [],
      missingReuseSurfaces: [...spec.reuseSurfaces],
    };
  }
  const doc = readBoundedText(resolvedDocPath, 'connector coverage doc');
  const section = getSectionBody(doc, spec.sectionHeading) ?? '';
  const connectorFamiliesPresent = spec.connectorFamilies.filter((family) =>
    section.includes(family),
  );
  const reuseSurfacesPresent = spec.reuseSurfaces.filter((surface) =>
    section.includes(surface),
  );
  return {
    docPath: resolvedDocPath,
    sectionExists: Boolean(section),
    connectorFamiliesPresent,
    missingConnectorFamilies: spec.connectorFamilies.filter(
      (family) => !connectorFamiliesPresent.includes(family),
    ),
    reuseSurfacesPresent,
    missingReuseSurfaces: spec.reuseSurfaces.filter(
      (surface) => !reuseSurfacesPresent.includes(surface),
    ),
  };
}

function buildTelemetryHygieneSummary(
  spec: PrivacySlaTelemetrySpec,
): TelemetryHygieneSummary {
  const resolvedDocPath = resolveDocPath(spec.docPath);
  if (!existsSync(resolvedDocPath)) {
    return {
      docPath: resolvedDocPath,
      sectionExists: false,
      snippetPresent: false,
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(resolvedDocPath, 'telemetry hygiene doc');
  const section = getSectionBody(doc, spec.sectionHeading) ?? '';
  return {
    docPath: resolvedDocPath,
    sectionExists: Boolean(section),
    snippetPresent: section.includes(spec.snippet),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

export function evaluatePrivacySlaReport(
  report: Omit<PrivacySlaDrillReport, 'assertions'>,
): string[] {
  const errors: string[] = [];
  if (report.modeAToolCount !== OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount})`,
    );
  }
  const actualPathIds = report.slaPaths.map((path) => path.id);
  for (const expectedPathId of OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.map((path) => path.id)) {
    if (!actualPathIds.includes(expectedPathId)) {
      errors.push(`privacy SLA manifest is missing path ${expectedPathId}`);
    }
  }
  for (const path of report.slaPaths) {
    const expectedPath = OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.find(
      (candidate) => candidate.id === path.id,
    );
    if (!path.docExists) {
      errors.push(`privacy SLA doc is missing for ${path.id}`);
    }
    if (!path.routeMatches) {
      errors.push(`privacy SLA section ${path.id} is missing route ${path.route}`);
    }
    if (!path.owner.trim()) {
      errors.push(`privacy SLA manifest ${path.id} is missing an owner`);
    }
    if (!path.deadline.trim()) {
      errors.push(`privacy SLA manifest ${path.id} is missing a deadline`);
    }
    if (!path.ownerLine) {
      errors.push(`privacy SLA section ${path.id} is missing an Owner line`);
    } else if (path.ownerLine !== path.owner) {
      errors.push(
        `privacy SLA section ${path.id} owner mismatch (${path.ownerLine} !== ${path.owner})`,
      );
    }
    if (!path.deadlineLine) {
      errors.push(`privacy SLA section ${path.id} is missing a Deadline line`);
    } else if (path.deadlineLine !== path.deadline) {
      errors.push(
        `privacy SLA section ${path.id} deadline mismatch (${path.deadlineLine} !== ${path.deadline})`,
      );
    }
    if (expectedPath && path.owner !== expectedPath.ownerRole) {
      errors.push(
        `privacy SLA manifest ${path.id} owner mismatch (${path.owner} !== ${expectedPath.ownerRole})`,
      );
    }
    if (expectedPath && path.deadline !== expectedPath.deadline) {
      errors.push(
        `privacy SLA manifest ${path.id} deadline mismatch (${path.deadline} !== ${expectedPath.deadline})`,
      );
    }
    if (path.explicitProjectIdRequired && !path.hasExplicitProjectIdNote) {
      errors.push(`privacy SLA section ${path.id} is missing explicit project_id guidance`);
    }
    if (path.metadataOnlyAudit && !path.hasMetadataOnlyAuditNote) {
      errors.push(`privacy SLA section ${path.id} is missing metadata-only audit guidance`);
    }
    if (path.connectorDerivedCoverage && !path.hasConnectorDerivedCoverageNote) {
      errors.push(`privacy SLA section ${path.id} is missing connector-derived coverage`);
    }
    if (path.suspiciousExampleLabels.length > 0) {
      errors.push(
        `privacy SLA section ${path.id} includes suspicious examples (${path.suspiciousExampleLabels.join(', ')})`,
      );
    }
  }
  if (!report.connectorCoverage.sectionExists) {
    errors.push('connector-derived coverage section is missing');
  }
  if (report.connectorCoverage.missingConnectorFamilies.length > 0) {
    errors.push(
      `connector-derived coverage is missing families (${report.connectorCoverage.missingConnectorFamilies.join(', ')})`,
    );
  }
  if (report.connectorCoverage.missingReuseSurfaces.length > 0) {
    errors.push(
      `connector-derived coverage is missing reuse surfaces (${report.connectorCoverage.missingReuseSurfaces.join(', ')})`,
    );
  }
  if (!report.telemetryHygiene.sectionExists) {
    errors.push('telemetry hygiene section is missing');
  }
  if (!report.telemetryHygiene.snippetPresent) {
    errors.push('telemetry hygiene section is missing the official redaction guidance');
  }
  if (report.telemetryHygiene.suspiciousExampleLabels.length > 0) {
    errors.push(
      `telemetry hygiene section includes suspicious examples (${report.telemetryHygiene.suspiciousExampleLabels.join(', ')})`,
    );
  }
  return errors;
}

export function privacySlaDrillConfigInputFromEnv(
  env: Record<string, string | undefined>,
): PrivacySlaDrillConfigInput {
  return {
    fixtureDir: trimToNull(env.MEMORY_OS_PRIVACY_SLA_FIXTURE_DIR) ?? undefined,
    manifestPath: trimToNull(env.MEMORY_OS_PRIVACY_SLA_MANIFEST_PATH) ?? undefined,
    projectId:
      trimToNull(env.MEMORY_OS_PRIVACY_SLA_PROJECT_ID) ??
      trimToNull(env.MEMORY_OS_PROJECT_ID) ??
      undefined,
    workspaceId:
      trimToNull(env.MEMORY_OS_WORKSPACE_ID) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolvePrivacySlaDrillConfig(
  input: PrivacySlaDrillConfigInput,
): ResolvedPrivacySlaDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    fixtureDir,
    trimToNull(input.manifestPath) ?? 'sla-manifest.json',
  );
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded privacy SLA drill; no default project fallback',
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolvePrivacySlaDrillConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedPrivacySlaDrillConfig {
  return resolvePrivacySlaDrillConfig(privacySlaDrillConfigInputFromEnv(env));
}

export async function runPrivacySlaDrill(
  input: PrivacySlaDrillConfigInput,
): Promise<PrivacySlaDrillReport> {
  const config = resolvePrivacySlaDrillConfig(input);
  const manifest = readFixtureJson<PrivacySlaManifest>(
    config.manifestPath,
    'privacy SLA manifest',
  );
  const manifestErrors: string[] = [];
  if (manifest.manifestVersion !== OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION) {
    manifestErrors.push(
      `privacy SLA manifest version mismatch (${manifest.manifestVersion} !== ${OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION})`,
    );
  }
  if (manifest.packVersion !== OFFICIAL_M14_PRIVACY_SLA_PACK.version) {
    manifestErrors.push(
      `privacy SLA pack version mismatch (${manifest.packVersion} !== ${OFFICIAL_M14_PRIVACY_SLA_PACK.version})`,
    );
  }
  if (manifest.source !== 'fixture-local') {
    manifestErrors.push(`privacy SLA manifest source must stay fixture-local (${manifest.source})`);
  }
  if (
    JSON.stringify(manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_PRIVACY_SLA_PACK.roadmapSections)
  ) {
    manifestErrors.push(
      `privacy SLA roadmap sections mismatch (${manifest.roadmapSections.join(', ')} !== ${OFFICIAL_M14_PRIVACY_SLA_PACK.roadmapSections.join(', ')})`,
    );
  }
  const expectedPathIds = OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.map((path) => path.id);
  const actualPathIds = manifest.slaPaths.map((path) => path.id);
  for (const expectedPathId of expectedPathIds) {
    if (!actualPathIds.includes(expectedPathId)) {
      manifestErrors.push(`privacy SLA manifest is missing path ${expectedPathId}`);
    }
  }
  for (const family of REQUIRED_CONNECTOR_FAMILIES) {
    if (!manifest.connectorCoverage.connectorFamilies.includes(family)) {
      manifestErrors.push(`privacy SLA manifest is missing connector family ${family}`);
    }
  }
  for (const surface of REQUIRED_REUSE_SURFACES) {
    if (!manifest.connectorCoverage.reuseSurfaces.includes(surface)) {
      manifestErrors.push(`privacy SLA manifest is missing reuse surface ${surface}`);
    }
  }
  const sectionSummaries = manifest.slaPaths.map(buildSlaSectionSummary);
  const connectorCoverage = buildConnectorCoverageSummary(manifest.connectorCoverage);
  const telemetryHygiene = buildTelemetryHygieneSummary(manifest.telemetryHygiene);
  const reportBase = {
    recipeVersion: OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
    config,
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    slaPaths: sectionSummaries.map((summary) => ({
      id: summary.manifestPath.id,
      route: summary.manifestPath.route,
      requestType: summary.manifestPath.requestType ?? null,
      owner: summary.manifestPath.owner,
      deadline: summary.manifestPath.deadline,
      docPath: summary.resolvedDocPath,
      explicitProjectIdRequired: summary.manifestPath.explicitProjectIdRequired,
      metadataOnlyAudit: summary.manifestPath.metadataOnlyAudit,
      connectorDerivedCoverage: summary.manifestPath.connectorDerivedCoverage,
      docExists: summary.docExists,
      routeMatches: summary.routeMatches,
      ownerLine: summary.ownerLine,
      deadlineLine: summary.deadlineLine,
      hasExplicitProjectIdNote: summary.hasExplicitProjectIdNote,
      hasMetadataOnlyAuditNote: summary.hasMetadataOnlyAuditNote,
      hasConnectorDerivedCoverageNote: summary.hasConnectorDerivedCoverageNote,
      suspiciousExampleLabels: summary.suspiciousExampleLabels,
    })),
    connectorCoverage,
    telemetryHygiene,
    writeActionsAttempted: 0 as const,
    verifiedWritesAttempted: 0 as const,
  };
  const errors = [
    ...manifestErrors,
    ...evaluatePrivacySlaReport(reportBase),
  ];
  return {
    ...reportBase,
    assertions: {
      ok: errors.length === 0,
      errors,
    },
  };
}

export {
  REQUIRED_CONNECTOR_FAMILIES,
  REQUIRED_REUSE_SURFACES,
  TELEMETRY_HYGIENE_SNIPPET,
};

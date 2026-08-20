import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHATGPT_PILOT_TOOLS,
  DEFAULT_PROJECT_ID,
  DEFAULT_WORKSPACE_ID,
} from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK,
  OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/dependency-upgrade/m14-s07-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;
const TELEMETRY_HYGIENE_SNIPPET =
  'Do not log tokens, secrets, memory bodies, or dependency-upgrade payloads in CI output, upgrade notes, or validator output.';
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
    pattern: /"(?:payload|body|content|memories|upgrade)"\s*:\s*(?:\{|\[|")/i,
  },
  {
    label: 'secret-assignment-example',
    pattern:
      /\b(?:service_role|vault_key|refresh_token|access_token)\s*=\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
] as const;
const PROTOCOL_VERSION_PATTERN = /protocolVersion["']?\s*[:=]\s*["']([^"']+)["']/g;

type DependencyUpgradeControlId =
  (typeof OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls)[number]['id'];

type DependencyUpgradeIntakeSpec = {
  docPath: string;
  sectionHeading: string;
  owner: string;
  rollback: string;
  requiredSnippets: string[];
};

type DependencyUpgradeControlSpec = {
  id: DependencyUpgradeControlId;
  title: string;
  owner: string;
  docPath: string;
  sectionHeading: string;
  requiredSnippets: string[];
};

type DependencyUpgradeProtocolEvidenceSpec = {
  title: string;
  path: string;
  expectedVersions: string[];
  adrPaths: string[];
  contractEvidence: string[];
};

type DependencyUpgradeTelemetrySpec = {
  docPath: string;
  sectionHeading: string;
  snippet: string;
};

type DependencyUpgradeManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  intake: DependencyUpgradeIntakeSpec;
  controls: DependencyUpgradeControlSpec[];
  protocolEvidence: DependencyUpgradeProtocolEvidenceSpec[];
  telemetryHygiene: DependencyUpgradeTelemetrySpec;
};

type IntakeSummary = {
  docPath: string;
  docExists: boolean;
  sectionExists: boolean;
  owner: string;
  rollback: string;
  ownerLine: string | null;
  rollbackLine: string | null;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

type ControlSummary = {
  id: DependencyUpgradeControlId;
  title: string;
  docPath: string;
  docExists: boolean;
  sectionExists: boolean;
  owner: string;
  ownerLine: string | null;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

type ProtocolEvidenceSummary = {
  title: string;
  path: string;
  fileExists: boolean;
  expectedVersions: string[];
  actualVersions: string[];
  adrPaths: string[];
  missingAdrPaths: string[];
  contractEvidence: string[];
  missingContractEvidence: string[];
};

type TelemetryHygieneSummary = {
  docPath: string;
  sectionExists: boolean;
  snippetPresent: boolean;
  suspiciousExampleLabels: string[];
};

export const OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION = 'm14-s07-v1' as const;

export const OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE = {
  version: OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.version,
  roadmapSections: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.roadmapSections,
  controls: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.map((control) => control.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxControls: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.length,
  },
  invariants: {
    modeAToolCount:
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount,
    requireUpgradeOwner: true,
    requireRollbackNote: true,
    requireContractTests: true,
    requireSmokeTest: true,
    requireProtocolAdrForMcpOrSdkChanges: true,
    requireProtocolContractTests: true,
    requireExplicitProjectIdOnWriteAdminOrApplyInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    allowLiveMassUpgrade: false,
    allowNewVendor: false,
    allowSilentProtocolBump: false,
    logPayloadBodies: false,
  },
} as const;

export type DependencyUpgradeDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedDependencyUpgradeDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type DependencyUpgradeDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION;
  config: Pick<
    ResolvedDependencyUpgradeDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  blockedFallbackProjectIds: string[];
  modeAToolCount: number;
  intake: IntakeSummary;
  controls: ControlSummary[];
  protocolEvidence: ProtocolEvidenceSummary[];
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
  const startIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${normalizedHeading}`,
  );
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function findProtocolVersions(contents: string): string[] {
  const matches = [...contents.matchAll(PROTOCOL_VERSION_PATTERN)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
  return uniqueSorted(matches);
}

function buildIntakeSummary(spec: DependencyUpgradeIntakeSpec): IntakeSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      docPath,
      docExists: false,
      sectionExists: false,
      owner: spec.owner,
      rollback: spec.rollback,
      ownerLine: null,
      rollbackLine: null,
      missingRequiredSnippets: [...spec.requiredSnippets],
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, 'dependency upgrade policy doc');
  const section = getSectionBody(doc, spec.sectionHeading) ?? '';
  return {
    docPath,
    docExists: true,
    sectionExists: Boolean(section),
    owner: spec.owner,
    rollback: spec.rollback,
    ownerLine: extractFieldLine(section, 'Owner'),
    rollbackLine: extractFieldLine(section, 'Rollback'),
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !section.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

function buildControlSummary(spec: DependencyUpgradeControlSpec): ControlSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      id: spec.id,
      title: spec.title,
      docPath,
      docExists: false,
      sectionExists: false,
      owner: spec.owner,
      ownerLine: null,
      missingRequiredSnippets: [...spec.requiredSnippets],
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, `dependency upgrade control doc for ${spec.id}`);
  const section = getSectionBody(doc, spec.sectionHeading) ?? '';
  return {
    id: spec.id,
    title: spec.title,
    docPath,
    docExists: true,
    sectionExists: Boolean(section),
    owner: spec.owner,
    ownerLine: extractFieldLine(section, 'Owner'),
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !section.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

function buildProtocolEvidenceSummary(
  spec: DependencyUpgradeProtocolEvidenceSpec,
): ProtocolEvidenceSummary {
  const path = resolveDocPath(spec.path);
  const adrPaths = spec.adrPaths.map(resolveDocPath);
  const contractEvidence = spec.contractEvidence.map(resolveDocPath);
  if (!existsSync(path)) {
    return {
      title: spec.title,
      path,
      fileExists: false,
      expectedVersions: uniqueSorted(spec.expectedVersions),
      actualVersions: [],
      adrPaths,
      missingAdrPaths: [...adrPaths],
      contractEvidence,
      missingContractEvidence: [...contractEvidence],
    };
  }
  const contents = readBoundedText(path, `protocol evidence file for ${spec.title}`);
  return {
    title: spec.title,
    path,
    fileExists: true,
    expectedVersions: uniqueSorted(spec.expectedVersions),
    actualVersions: findProtocolVersions(contents),
    adrPaths,
    missingAdrPaths: adrPaths.filter((adrPath) => !existsSync(adrPath)),
    contractEvidence,
    missingContractEvidence: contractEvidence.filter((evidencePath) => !existsSync(evidencePath)),
  };
}

function buildTelemetryHygieneSummary(
  spec: DependencyUpgradeTelemetrySpec,
): TelemetryHygieneSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      docPath,
      sectionExists: false,
      snippetPresent: false,
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, 'dependency upgrade telemetry doc');
  const section = getSectionBody(doc, spec.sectionHeading) ?? '';
  return {
    docPath,
    sectionExists: Boolean(section),
    snippetPresent: section.includes(spec.snippet),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

export function evaluateDependencyUpgradeReport(
  report: Omit<DependencyUpgradeDrillReport, 'assertions'>,
): string[] {
  const errors: string[] = [];
  if (
    report.modeAToolCount !==
    OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount
  ) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount})`,
    );
  }
  if (!report.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    errors.push(
      `dependency upgrade policy must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  if (!report.intake.docExists) {
    errors.push('dependency upgrade intake doc is missing');
  }
  if (!report.intake.sectionExists) {
    errors.push('dependency upgrade intake section is missing');
  }
  if (!report.intake.owner.trim()) {
    errors.push('dependency upgrade intake manifest is missing an owner');
  }
  if (!report.intake.rollback.trim()) {
    errors.push('dependency upgrade intake manifest is missing a rollback note');
  }
  if (!report.intake.ownerLine) {
    errors.push('dependency upgrade intake section is missing an Owner line');
  } else if (report.intake.ownerLine !== report.intake.owner) {
    errors.push(
      `dependency upgrade intake owner mismatch (${report.intake.ownerLine} !== ${report.intake.owner})`,
    );
  }
  if (!report.intake.rollbackLine) {
    errors.push('dependency upgrade intake section is missing a Rollback line');
  } else if (report.intake.rollbackLine !== report.intake.rollback) {
    errors.push(
      `dependency upgrade intake rollback mismatch (${report.intake.rollbackLine} !== ${report.intake.rollback})`,
    );
  }
  if (report.intake.missingRequiredSnippets.length > 0) {
    errors.push(
      `dependency upgrade intake is missing required snippets (${report.intake.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.intake.suspiciousExampleLabels.length > 0) {
    errors.push(
      `dependency upgrade intake includes suspicious examples (${report.intake.suspiciousExampleLabels.join(', ')})`,
    );
  }

  const actualControlIds = report.controls.map((control) => control.id);
  for (const expectedControlId of OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.map(
    (control) => control.id,
  )) {
    if (!actualControlIds.includes(expectedControlId)) {
      errors.push(`dependency upgrade manifest is missing control ${expectedControlId}`);
    }
  }
  for (const control of report.controls) {
    const expectedControl = OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.find(
      (candidate) => candidate.id === control.id,
    );
    if (!control.docExists) {
      errors.push(`dependency upgrade doc is missing for control ${control.id}`);
    }
    if (!control.sectionExists) {
      errors.push(`dependency upgrade control section ${control.id} is missing`);
    }
    if (!control.owner.trim()) {
      errors.push(`dependency upgrade control ${control.id} is missing an owner`);
    }
    if (!control.ownerLine) {
      errors.push(`dependency upgrade control section ${control.id} is missing an Owner line`);
    } else if (control.ownerLine !== control.owner) {
      errors.push(
        `dependency upgrade control ${control.id} owner mismatch (${control.ownerLine} !== ${control.owner})`,
      );
    }
    if (expectedControl && control.owner !== expectedControl.ownerRole) {
      errors.push(
        `dependency upgrade control ${control.id} owner mismatch (${control.owner} !== ${expectedControl.ownerRole})`,
      );
    }
    if (control.missingRequiredSnippets.length > 0) {
      errors.push(
        `dependency upgrade control ${control.id} is missing required snippets (${control.missingRequiredSnippets.join(', ')})`,
      );
    }
    if (control.suspiciousExampleLabels.length > 0) {
      errors.push(
        `dependency upgrade control ${control.id} includes suspicious examples (${control.suspiciousExampleLabels.join(', ')})`,
      );
    }
  }

  for (const evidence of report.protocolEvidence) {
    if (!evidence.fileExists) {
      errors.push(`protocol evidence file is missing for ${evidence.title}`);
      continue;
    }
    if (evidence.actualVersions.length === 0) {
      errors.push(`protocol evidence ${evidence.title} is missing a protocolVersion marker`);
    } else if (
      JSON.stringify(evidence.actualVersions) !== JSON.stringify(evidence.expectedVersions)
    ) {
      errors.push(
        `protocol evidence ${evidence.title} version drift (${evidence.actualVersions.join(', ')} !== ${evidence.expectedVersions.join(', ')})`,
      );
    }
    if (evidence.adrPaths.length === 0) {
      errors.push(`protocol evidence ${evidence.title} is missing ADR references`);
    }
    if (evidence.missingAdrPaths.length > 0) {
      errors.push(
        `protocol evidence ${evidence.title} is missing ADR paths (${evidence.missingAdrPaths.join(', ')})`,
      );
    }
    if (evidence.contractEvidence.length === 0) {
      errors.push(`protocol evidence ${evidence.title} is missing contract evidence`);
    }
    if (evidence.missingContractEvidence.length > 0) {
      errors.push(
        `protocol evidence ${evidence.title} is missing contract evidence paths (${evidence.missingContractEvidence.join(', ')})`,
      );
    }
  }

  if (!report.telemetryHygiene.sectionExists) {
    errors.push('dependency upgrade telemetry hygiene section is missing');
  }
  if (!report.telemetryHygiene.snippetPresent) {
    errors.push(
      'dependency upgrade telemetry hygiene section is missing the official redaction guidance',
    );
  }
  if (report.telemetryHygiene.suspiciousExampleLabels.length > 0) {
    errors.push(
      `dependency upgrade telemetry hygiene includes suspicious examples (${report.telemetryHygiene.suspiciousExampleLabels.join(', ')})`,
    );
  }

  if (report.writeActionsAttempted !== 0) {
    errors.push(`dependency upgrade drill attempted writes (${report.writeActionsAttempted})`);
  }
  if (report.verifiedWritesAttempted !== 0) {
    errors.push(
      `dependency upgrade drill attempted verified-memory writes (${report.verifiedWritesAttempted})`,
    );
  }
  return errors;
}

export function dependencyUpgradeDrillConfigInputFromEnv(
  env: Record<string, string | undefined>,
): DependencyUpgradeDrillConfigInput {
  return {
    fixtureDir: trimToNull(env.MEMORY_OS_DEPENDENCY_UPGRADE_FIXTURE_DIR) ?? undefined,
    manifestPath: trimToNull(env.MEMORY_OS_DEPENDENCY_UPGRADE_MANIFEST_PATH) ?? undefined,
    projectId:
      trimToNull(env.MEMORY_OS_DEPENDENCY_UPGRADE_PROJECT_ID) ??
      trimToNull(env.MEMORY_OS_PROJECT_ID) ??
      undefined,
    workspaceId:
      trimToNull(env.MEMORY_OS_DEPENDENCY_UPGRADE_WORKSPACE_ID) ??
      trimToNull(env.MEMORY_OS_WORKSPACE_ID) ??
      DEFAULT_WORKSPACE_ID,
  };
}

export function resolveDependencyUpgradeDrillConfig(
  input: DependencyUpgradeDrillConfigInput,
): ResolvedDependencyUpgradeDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    fixtureDir,
    trimToNull(input.manifestPath) ?? 'policy-manifest.json',
  );
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded dependency upgrade drill; no default project fallback',
    );
  }
  if (projectId === DEFAULT_PROJECT_ID) {
    throw new Error(
      `AISTROYKA fallback project_id ${DEFAULT_PROJECT_ID} is not allowed for the bounded dependency upgrade drill`,
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolveDependencyUpgradeDrillConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedDependencyUpgradeDrillConfig {
  return resolveDependencyUpgradeDrillConfig(dependencyUpgradeDrillConfigInputFromEnv(env));
}

export async function runDependencyUpgradeDrill(
  input: DependencyUpgradeDrillConfigInput,
): Promise<DependencyUpgradeDrillReport> {
  const config = resolveDependencyUpgradeDrillConfig(input);
  const manifest = readFixtureJson<DependencyUpgradeManifest>(
    config.manifestPath,
    'dependency upgrade manifest',
  );
  const manifestErrors: string[] = [];
  if (manifest.manifestVersion !== OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION) {
    manifestErrors.push(
      `dependency upgrade manifest version mismatch (${manifest.manifestVersion} !== ${OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION})`,
    );
  }
  if (manifest.packVersion !== OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.version) {
    manifestErrors.push(
      `dependency upgrade pack version mismatch (${manifest.packVersion} !== ${OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.version})`,
    );
  }
  if (manifest.source !== 'fixture-local') {
    manifestErrors.push(
      `dependency upgrade manifest source must stay fixture-local (${manifest.source})`,
    );
  }
  if (
    JSON.stringify(manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.roadmapSections)
  ) {
    manifestErrors.push(
      `dependency upgrade roadmap sections mismatch (${manifest.roadmapSections.join(', ')} !== ${OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.roadmapSections.join(', ')})`,
    );
  }
  if (!manifest.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    manifestErrors.push(
      `dependency upgrade manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  const expectedControlIds = OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.map(
    (control) => control.id,
  );
  const actualControlIds = manifest.controls.map((control) => control.id);
  for (const expectedControlId of expectedControlIds) {
    if (!actualControlIds.includes(expectedControlId)) {
      manifestErrors.push(`dependency upgrade manifest is missing control ${expectedControlId}`);
    }
  }

  const intake = buildIntakeSummary(manifest.intake);
  const controls = manifest.controls.map(buildControlSummary);
  const protocolEvidence = manifest.protocolEvidence.map(buildProtocolEvidenceSummary);
  const telemetryHygiene = buildTelemetryHygieneSummary(manifest.telemetryHygiene);
  const reportBase = {
    recipeVersion: OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
    config,
    blockedFallbackProjectIds: manifest.blockedFallbackProjectIds,
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    intake,
    controls,
    protocolEvidence,
    telemetryHygiene,
    writeActionsAttempted: 0 as const,
    verifiedWritesAttempted: 0 as const,
  };
  const errors = [
    ...manifestErrors,
    ...evaluateDependencyUpgradeReport(reportBase),
  ];
  return {
    ...reportBase,
    assertions: {
      ok: errors.length === 0,
      errors,
    },
  };
}

export { TELEMETRY_HYGIENE_SNIPPET };

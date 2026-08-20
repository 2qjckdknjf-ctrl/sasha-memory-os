import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHATGPT_PILOT_TOOLS,
  DEFAULT_PROJECT_ID,
  DEFAULT_WORKSPACE_ID,
} from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_SUPPORT_OPS_PACK,
  OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/support-ops/m14-s10-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;

export const SUPPORT_OPS_REDACTION_SNIPPET =
  'Redacted on /ops — use scoped pages, privacy, or runbooks instead of raw payloads.';

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
    pattern: /"(?:payload|body|content|memories|export)"\s*:\s*(?:\{|\[|")/i,
  },
  {
    label: 'secret-assignment-example',
    pattern:
      /\b(?:service_role|vault_key|refresh_token|access_token)\s*=\s*(?!\[REDACTED\]|<redacted>|<token>|redacted\b)[^\s`]+/i,
  },
] as const;

type SupportOpsLinkId =
  (typeof OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks)[number]['id'];

type SupportOpsDocSpec = {
  docPath: string;
  requiredSnippets: string[];
  forbiddenSnippets?: string[];
};

type SupportOpsLinkSpec = {
  id: SupportOpsLinkId;
  owner: string;
  kind: 'route' | 'doc';
  target: string;
  requiredSnippets: string[];
};

type SupportOpsManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  opsPage: SupportOpsDocSpec;
  sliceDoc: SupportOpsDocSpec;
  requiredLinks: SupportOpsLinkSpec[];
};

type SupportOpsDocSummary = {
  docPath: string;
  docExists: boolean;
  missingRequiredSnippets: string[];
  forbiddenSnippetsPresent: string[];
  suspiciousExampleLabels: string[];
};

type SupportOpsLinkSummary = {
  id: SupportOpsLinkId;
  owner: string;
  kind: 'route' | 'doc';
  target: string;
  presentInOpsPage: boolean;
  missingRequiredSnippets: string[];
};

export const OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION = 'm14-s10-v1' as const;

export const OFFICIAL_M14_SUPPORT_OPS_RECIPE = {
  version: OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_SUPPORT_OPS_PACK.version,
  roadmapSections: OFFICIAL_M14_SUPPORT_OPS_PACK.roadmapSections,
  supportLinks: OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map((link) => link.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxSupportLinks: OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.length,
  },
  invariants: {
    reuseExistingOpsPage: true,
    actorSwitchingDemoOnly: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    modeAToolCount: OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRevoke: false,
    allowLiveRollback: false,
    allowProductionSqlApply: false,
    allowParallelOpsApp: false,
    allowNewPagerProduct: false,
    allowNewVendor: false,
    logPayloadBodies: false,
  },
} as const;

export type SupportOpsDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedSupportOpsDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type SupportOpsDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION;
  config: Pick<
    ResolvedSupportOpsDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  blockedFallbackProjectIds: string[];
  modeAToolCount: number;
  opsPage: SupportOpsDocSummary;
  sliceDoc: SupportOpsDocSummary;
  requiredLinks: SupportOpsLinkSummary[];
  writeActionsAttempted: 0;
  verifiedWritesAttempted: 0;
  ownerTokenBypassAttempts: 0;
  liveOpsActionsAttempted: 0;
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
  const explicit = trimToNull(pathValue);
  const resolved = resolve(explicit ?? DEFAULT_FIXTURE_DIR);
  if (explicit && !existsSync(resolved)) {
    throw new Error(`support / ops fixture directory does not exist: ${resolved}`);
  }
  return resolved;
}

function resolveDocPath(pathValue: string): string {
  return pathValue.startsWith('/') ? pathValue : resolve(WORKSPACE_ROOT, pathValue);
}

function readBoundedText(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing: ${path}`);
  }
  const bytes = statSync(path).size;
  if (bytes > MAX_FIXTURE_BYTES) {
    throw new Error(
      `${label} exceeds bounded fixture size (${bytes} > ${MAX_FIXTURE_BYTES})`,
    );
  }
  return readFileSync(path, 'utf8');
}

function readFixtureJson<T>(path: string, label: string): T {
  return JSON.parse(readBoundedText(path, label)) as T;
}

function suspiciousExampleLabels(doc: string): string[] {
  return SUSPICIOUS_DOC_PATTERNS.flatMap(({ label, pattern }) =>
    pattern.test(doc) ? [label] : [],
  );
}

function buildDocSummary(spec: SupportOpsDocSpec, label: string): SupportOpsDocSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      docPath,
      docExists: false,
      missingRequiredSnippets: [...spec.requiredSnippets],
      forbiddenSnippetsPresent: [],
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, label);
  return {
    docPath,
    docExists: true,
    missingRequiredSnippets: spec.requiredSnippets.filter((snippet) => !doc.includes(snippet)),
    forbiddenSnippetsPresent: (spec.forbiddenSnippets ?? []).filter((snippet) =>
      doc.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(doc),
  };
}

function buildLinkSummaries(
  opsDocPath: string,
  links: SupportOpsLinkSpec[],
): SupportOpsLinkSummary[] {
  if (!existsSync(opsDocPath)) {
    return links.map((link) => ({
      ...link,
      presentInOpsPage: false,
      missingRequiredSnippets: [...link.requiredSnippets],
    }));
  }
  const doc = readBoundedText(opsDocPath, 'ops page source');
  const rendersSupportLinks = doc.includes('OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map');
  return links.map((link) => ({
    ...link,
    presentInOpsPage: rendersSupportLinks,
    missingRequiredSnippets: link.requiredSnippets.filter((snippet) => !doc.includes(snippet)),
  }));
}

export function evaluateSupportOpsDrillReport(
  report: Omit<SupportOpsDrillReport, 'assertions'>,
): string[] {
  const errors: string[] = [];

  if (
    report.modeAToolCount !== OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount
  ) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount})`,
    );
  }
  if (!report.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    errors.push(
      `support / ops manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  if (!report.opsPage.docExists) {
    errors.push('ops page source is missing');
  }
  if (report.opsPage.missingRequiredSnippets.length > 0) {
    errors.push(
      `ops page source is missing required snippets (${report.opsPage.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.opsPage.forbiddenSnippetsPresent.length > 0) {
    errors.push(
      `ops page source reintroduced raw payload rendering (${report.opsPage.forbiddenSnippetsPresent.join(', ')})`,
    );
  }
  if (report.opsPage.suspiciousExampleLabels.length > 0) {
    errors.push(
      `ops page source includes suspicious examples (${report.opsPage.suspiciousExampleLabels.join(', ')})`,
    );
  }
  if (!report.sliceDoc.docExists) {
    errors.push('M14 Slice 10 doc is missing');
  }
  if (report.sliceDoc.missingRequiredSnippets.length > 0) {
    errors.push(
      `M14 Slice 10 doc is missing required snippets (${report.sliceDoc.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.sliceDoc.forbiddenSnippetsPresent.length > 0) {
    errors.push(
      `M14 Slice 10 doc includes forbidden snippets (${report.sliceDoc.forbiddenSnippetsPresent.join(', ')})`,
    );
  }
  if (report.sliceDoc.suspiciousExampleLabels.length > 0) {
    errors.push(
      `M14 Slice 10 doc includes suspicious examples (${report.sliceDoc.suspiciousExampleLabels.join(', ')})`,
    );
  }

  for (const officialLink of OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks) {
    const reportLink = report.requiredLinks.find((link) => link.id === officialLink.id);
    if (!reportLink) {
      errors.push(`support / ops manifest is missing required link ${officialLink.id}`);
      continue;
    }
    if (reportLink.owner !== officialLink.ownerRole) {
      errors.push(
        `support / ops owner mismatch for ${officialLink.id} (${reportLink.owner} !== ${officialLink.ownerRole})`,
      );
    }
    if (reportLink.target !== officialLink.target) {
      errors.push(
        `support / ops target mismatch for ${officialLink.id} (${reportLink.target} !== ${officialLink.target})`,
      );
    }
    if (!reportLink.presentInOpsPage) {
      errors.push(`ops page is missing link target ${officialLink.target}`);
    }
    if (reportLink.missingRequiredSnippets.length > 0) {
      errors.push(
        `ops page link ${officialLink.id} is missing required snippets (${reportLink.missingRequiredSnippets.join(', ')})`,
      );
    }
  }

  if (report.writeActionsAttempted !== 0) {
    errors.push(`support / ops drill attempted writes (${report.writeActionsAttempted})`);
  }
  if (report.verifiedWritesAttempted !== 0) {
    errors.push(
      `support / ops drill attempted verified-memory writes (${report.verifiedWritesAttempted})`,
    );
  }
  if (report.ownerTokenBypassAttempts !== 0) {
    errors.push(
      `support / ops drill attempted owner-token bypass (${report.ownerTokenBypassAttempts})`,
    );
  }
  if (report.liveOpsActionsAttempted !== 0) {
    errors.push(
      `support / ops drill attempted live ops actions (${report.liveOpsActionsAttempted})`,
    );
  }

  return errors;
}

export function supportOpsDrillConfigInputFromEnv(
  env: Record<string, string | undefined>,
): SupportOpsDrillConfigInput {
  return {
    fixtureDir: trimToNull(env.MEMORY_OS_SUPPORT_OPS_FIXTURE_DIR) ?? undefined,
    manifestPath: trimToNull(env.MEMORY_OS_SUPPORT_OPS_MANIFEST_PATH) ?? undefined,
    projectId:
      trimToNull(env.MEMORY_OS_SUPPORT_OPS_PROJECT_ID) ??
      trimToNull(env.MEMORY_OS_PROJECT_ID) ??
      undefined,
    workspaceId:
      trimToNull(env.MEMORY_OS_SUPPORT_OPS_WORKSPACE_ID) ??
      trimToNull(env.MEMORY_OS_WORKSPACE_ID) ??
      DEFAULT_WORKSPACE_ID,
  };
}

export function resolveSupportOpsDrillConfig(
  input: SupportOpsDrillConfigInput,
): ResolvedSupportOpsDrillConfig {
  const explicitFixtureDir = trimToNull(input.fixtureDir);
  const explicitManifestPath = trimToNull(input.manifestPath);
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    fixtureDir,
    explicitManifestPath ?? 'ops-manifest.json',
  );
  if ((explicitFixtureDir || explicitManifestPath) && !existsSync(manifestPath)) {
    throw new Error(`support / ops manifest path does not exist: ${manifestPath}`);
  }
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded support / ops drill; no default project fallback',
    );
  }
  if (projectId === DEFAULT_PROJECT_ID) {
    throw new Error(
      `AISTROYKA fallback project_id ${DEFAULT_PROJECT_ID} is not allowed for the bounded support / ops drill`,
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolveSupportOpsDrillConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedSupportOpsDrillConfig {
  return resolveSupportOpsDrillConfig(supportOpsDrillConfigInputFromEnv(env));
}

export async function runSupportOpsDrill(
  input: SupportOpsDrillConfigInput,
): Promise<SupportOpsDrillReport> {
  const config = resolveSupportOpsDrillConfig(input);
  const manifest = readFixtureJson<SupportOpsManifest>(
    config.manifestPath,
    'support / ops manifest',
  );
  const manifestErrors: string[] = [];

  if (manifest.manifestVersion !== OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION) {
    manifestErrors.push(
      `support / ops manifest version mismatch (${manifest.manifestVersion} !== ${OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION})`,
    );
  }
  if (manifest.packVersion !== OFFICIAL_M14_SUPPORT_OPS_PACK.version) {
    manifestErrors.push(
      `support / ops pack version mismatch (${manifest.packVersion} !== ${OFFICIAL_M14_SUPPORT_OPS_PACK.version})`,
    );
  }
  if (manifest.source !== 'fixture-local') {
    manifestErrors.push(
      `support / ops manifest source must stay fixture-local (${manifest.source})`,
    );
  }
  if (
    JSON.stringify(manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_SUPPORT_OPS_PACK.roadmapSections)
  ) {
    manifestErrors.push(
      `support / ops roadmap sections mismatch (${manifest.roadmapSections.join(', ')} !== ${OFFICIAL_M14_SUPPORT_OPS_PACK.roadmapSections.join(', ')})`,
    );
  }
  if (!manifest.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    manifestErrors.push(
      `support / ops manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }

  const opsPage = buildDocSummary(manifest.opsPage, 'ops page source');
  const sliceDoc = buildDocSummary(manifest.sliceDoc, 'M14 Slice 10 doc');
  const requiredLinks = buildLinkSummaries(resolveDocPath(manifest.opsPage.docPath), manifest.requiredLinks);

  const reportBase = {
    recipeVersion: OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
    config,
    blockedFallbackProjectIds: manifest.blockedFallbackProjectIds,
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    opsPage,
    sliceDoc,
    requiredLinks,
    writeActionsAttempted: 0 as const,
    verifiedWritesAttempted: 0 as const,
    ownerTokenBypassAttempts: 0 as const,
    liveOpsActionsAttempted: 0 as const,
  };

  const errors = [...manifestErrors, ...evaluateSupportOpsDrillReport(reportBase)];
  return {
    ...reportBase,
    assertions: {
      ok: errors.length === 0,
      errors,
    },
  };
}

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHATGPT_PILOT_TOOLS,
  DEFAULT_PROJECT_ID,
  DEFAULT_WORKSPACE_ID,
} from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_GA_DOC_CATALOG_PACK,
  OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
} from '@memory-os/observability';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const DEFAULT_FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/ga-doc-catalog/m14-s08-v1',
);
const MAX_FIXTURE_BYTES = 128 * 1024;
const CATALOG_REDACTION_SNIPPET =
  'Do not log memory bodies, tokens, or payload bodies in catalog text or local validator output.';
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

type GaDocSurfaceId =
  (typeof OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces)[number]['id'];

type GaDocCatalogSpec = {
  docPath: string;
  requiredSnippets: string[];
};

type RequiredDocSpec = {
  id: GaDocSurfaceId;
  title: string;
  owner: string;
  status: string;
  catalogSectionHeading: string;
  primaryDocPath: string;
  requiredSnippets: string[];
};

type GaDocCatalogManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  catalog: GaDocCatalogSpec;
  sliceDoc: GaDocCatalogSpec;
  requiredDocs: RequiredDocSpec[];
};

type CatalogDocSummary = {
  docPath: string;
  docExists: boolean;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

type RequiredDocSummary = {
  id: GaDocSurfaceId;
  title: string;
  primaryDocPath: string;
  primaryDocExists: boolean;
  catalogSectionExists: boolean;
  owner: string;
  status: string;
  ownerLine: string | null;
  statusLine: string | null;
  missingRequiredSnippets: string[];
  suspiciousExampleLabels: string[];
};

export const OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION = 'm14-s08-v1' as const;

export const OFFICIAL_M14_GA_DOC_CATALOG_RECIPE = {
  version: OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION,
  packVersion: OFFICIAL_M14_GA_DOC_CATALOG_PACK.version,
  roadmapSections: OFFICIAL_M14_GA_DOC_CATALOG_PACK.roadmapSections,
  surfaces: OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map((surface) => surface.id),
  bounds: {
    fixtureOnly: true,
    maxFixtureBytes: MAX_FIXTURE_BYTES,
    maxDocs: OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.length,
  },
  invariants: {
    modeAToolCount:
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount,
    requireCatalogIndex: true,
    requireDocOwner: true,
    requireDocStatus: true,
    failClosedWhenDocMissing: true,
    failClosedWhenCatalogLeaksTokens: true,
    failClosedWhenCatalogLeaksPayloads: true,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    logPayloadBodies: false,
  },
} as const;

export type GaDocCatalogDrillConfigInput = {
  fixtureDir?: string | null;
  manifestPath?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type ResolvedGaDocCatalogDrillConfig = {
  fixtureDir: string;
  manifestPath: string;
  projectId: string;
  workspaceId: string;
};

export type GaDocCatalogDrillReport = {
  recipeVersion: typeof OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION;
  packVersion: typeof OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION;
  config: Pick<
    ResolvedGaDocCatalogDrillConfig,
    'fixtureDir' | 'manifestPath' | 'projectId' | 'workspaceId'
  >;
  blockedFallbackProjectIds: string[];
  modeAToolCount: number;
  catalog: CatalogDocSummary;
  sliceDoc: CatalogDocSummary;
  requiredDocs: RequiredDocSummary[];
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

function buildCatalogDocSummary(spec: GaDocCatalogSpec): CatalogDocSummary {
  const docPath = resolveDocPath(spec.docPath);
  if (!existsSync(docPath)) {
    return {
      docPath,
      docExists: false,
      missingRequiredSnippets: [...spec.requiredSnippets],
      suspiciousExampleLabels: [],
    };
  }
  const doc = readBoundedText(docPath, 'GA doc catalog');
  return {
    docPath,
    docExists: true,
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !doc.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(doc),
  };
}

function buildRequiredDocSummary(
  catalogDocPath: string,
  spec: RequiredDocSpec,
): RequiredDocSummary {
  const primaryDocPath = resolveDocPath(spec.primaryDocPath);
  const catalog = readBoundedText(catalogDocPath, 'GA doc catalog');
  const section = getSectionBody(catalog, spec.catalogSectionHeading) ?? '';
  return {
    id: spec.id,
    title: spec.title,
    primaryDocPath,
    primaryDocExists: existsSync(primaryDocPath),
    catalogSectionExists: Boolean(section),
    owner: spec.owner,
    status: spec.status,
    ownerLine: extractFieldLine(section, 'Owner'),
    statusLine: extractFieldLine(section, 'Status'),
    missingRequiredSnippets: spec.requiredSnippets.filter(
      (snippet) => !section.includes(snippet),
    ),
    suspiciousExampleLabels: suspiciousExampleLabels(section),
  };
}

export function evaluateGaDocCatalogReport(
  report: Omit<GaDocCatalogDrillReport, 'assertions'>,
): string[] {
  const errors: string[] = [];

  if (
    report.modeAToolCount !==
    OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount
  ) {
    errors.push(
      `ChatGPT Mode A tool count changed (${report.modeAToolCount} !== ${OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount})`,
    );
  }
  if (!report.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    errors.push(
      `GA doc catalog must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  if (!report.catalog.docExists) {
    errors.push('GA doc catalog is missing');
  }
  if (report.catalog.missingRequiredSnippets.length > 0) {
    errors.push(
      `GA doc catalog is missing required snippets (${report.catalog.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.catalog.suspiciousExampleLabels.length > 0) {
    errors.push(
      `GA doc catalog includes suspicious examples (${report.catalog.suspiciousExampleLabels.join(', ')})`,
    );
  }
  if (!report.sliceDoc.docExists) {
    errors.push('M14 Slice 08 doc is missing');
  }
  if (report.sliceDoc.missingRequiredSnippets.length > 0) {
    errors.push(
      `M14 Slice 08 doc is missing required snippets (${report.sliceDoc.missingRequiredSnippets.join(', ')})`,
    );
  }
  if (report.sliceDoc.suspiciousExampleLabels.length > 0) {
    errors.push(
      `M14 Slice 08 doc includes suspicious examples (${report.sliceDoc.suspiciousExampleLabels.join(', ')})`,
    );
  }

  const actualIds = report.requiredDocs.map((doc) => doc.id);
  for (const expectedId of OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map(
    (surface) => surface.id,
  )) {
    if (!actualIds.includes(expectedId)) {
      errors.push(`GA doc manifest is missing required surface ${expectedId}`);
    }
  }

  for (const doc of report.requiredDocs) {
    const expectedSurface = OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.find(
      (surface) => surface.id === doc.id,
    );
    if (!doc.primaryDocExists) {
      errors.push(`required doc is missing for surface ${doc.id}`);
    }
    if (!doc.catalogSectionExists) {
      errors.push(`catalog section is missing for surface ${doc.id}`);
    }
    if (!doc.owner.trim()) {
      errors.push(`catalog manifest owner is missing for surface ${doc.id}`);
    }
    if (!doc.status.trim()) {
      errors.push(`catalog manifest status is missing for surface ${doc.id}`);
    }
    if (!doc.ownerLine) {
      errors.push(`catalog section is missing Owner for surface ${doc.id}`);
    } else if (doc.ownerLine !== doc.owner) {
      errors.push(
        `catalog owner mismatch for surface ${doc.id} (${doc.ownerLine} !== ${doc.owner})`,
      );
    }
    if (!doc.statusLine) {
      errors.push(`catalog section is missing Status for surface ${doc.id}`);
    } else if (doc.statusLine !== doc.status) {
      errors.push(
        `catalog status mismatch for surface ${doc.id} (${doc.statusLine} !== ${doc.status})`,
      );
    }
    if (expectedSurface && doc.owner !== expectedSurface.ownerRole) {
      errors.push(
        `catalog manifest owner mismatch for surface ${doc.id} (${doc.owner} !== ${expectedSurface.ownerRole})`,
      );
    }
    if (expectedSurface && doc.status !== expectedSurface.status) {
      errors.push(
        `catalog manifest status mismatch for surface ${doc.id} (${doc.status} !== ${expectedSurface.status})`,
      );
    }
    if (doc.missingRequiredSnippets.length > 0) {
      errors.push(
        `catalog section ${doc.id} is missing required snippets (${doc.missingRequiredSnippets.join(', ')})`,
      );
    }
    if (doc.suspiciousExampleLabels.length > 0) {
      errors.push(
        `catalog section ${doc.id} includes suspicious examples (${doc.suspiciousExampleLabels.join(', ')})`,
      );
    }
  }

  if (report.writeActionsAttempted !== 0) {
    errors.push(`GA doc drill attempted writes (${report.writeActionsAttempted})`);
  }
  if (report.verifiedWritesAttempted !== 0) {
    errors.push(
      `GA doc drill attempted verified-memory writes (${report.verifiedWritesAttempted})`,
    );
  }

  return errors;
}

export function gaDocCatalogDrillConfigInputFromEnv(
  env: Record<string, string | undefined>,
): GaDocCatalogDrillConfigInput {
  return {
    fixtureDir: trimToNull(env.MEMORY_OS_GA_DOC_CATALOG_FIXTURE_DIR) ?? undefined,
    manifestPath: trimToNull(env.MEMORY_OS_GA_DOC_CATALOG_MANIFEST_PATH) ?? undefined,
    projectId:
      trimToNull(env.MEMORY_OS_GA_DOC_CATALOG_PROJECT_ID) ??
      trimToNull(env.MEMORY_OS_PROJECT_ID) ??
      undefined,
    workspaceId:
      trimToNull(env.MEMORY_OS_GA_DOC_CATALOG_WORKSPACE_ID) ??
      trimToNull(env.MEMORY_OS_WORKSPACE_ID) ??
      DEFAULT_WORKSPACE_ID,
  };
}

export function resolveGaDocCatalogDrillConfig(
  input: GaDocCatalogDrillConfigInput,
): ResolvedGaDocCatalogDrillConfig {
  const fixtureDir = normalizeFixturePath(input.fixtureDir);
  const manifestPath = resolve(
    fixtureDir,
    trimToNull(input.manifestPath) ?? 'catalog-manifest.json',
  );
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded GA doc catalog drill; no default project fallback',
    );
  }
  if (projectId === DEFAULT_PROJECT_ID) {
    throw new Error(
      `AISTROYKA fallback project_id ${DEFAULT_PROJECT_ID} is not allowed for the bounded GA doc catalog drill`,
    );
  }
  return {
    fixtureDir,
    manifestPath,
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
  };
}

export function resolveGaDocCatalogDrillConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedGaDocCatalogDrillConfig {
  return resolveGaDocCatalogDrillConfig(gaDocCatalogDrillConfigInputFromEnv(env));
}

export async function runGaDocCatalogDrill(
  input: GaDocCatalogDrillConfigInput,
): Promise<GaDocCatalogDrillReport> {
  const config = resolveGaDocCatalogDrillConfig(input);
  const manifest = readFixtureJson<GaDocCatalogManifest>(
    config.manifestPath,
    'GA doc catalog manifest',
  );
  const manifestErrors: string[] = [];

  if (manifest.manifestVersion !== OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION) {
    manifestErrors.push(
      `GA doc catalog manifest version mismatch (${manifest.manifestVersion} !== ${OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION})`,
    );
  }
  if (manifest.packVersion !== OFFICIAL_M14_GA_DOC_CATALOG_PACK.version) {
    manifestErrors.push(
      `GA doc catalog pack version mismatch (${manifest.packVersion} !== ${OFFICIAL_M14_GA_DOC_CATALOG_PACK.version})`,
    );
  }
  if (manifest.source !== 'fixture-local') {
    manifestErrors.push(
      `GA doc catalog manifest source must stay fixture-local (${manifest.source})`,
    );
  }
  if (
    JSON.stringify(manifest.roadmapSections) !==
    JSON.stringify(OFFICIAL_M14_GA_DOC_CATALOG_PACK.roadmapSections)
  ) {
    manifestErrors.push(
      `GA doc catalog roadmap sections mismatch (${manifest.roadmapSections.join(', ')} !== ${OFFICIAL_M14_GA_DOC_CATALOG_PACK.roadmapSections.join(', ')})`,
    );
  }
  if (!manifest.blockedFallbackProjectIds.includes(DEFAULT_PROJECT_ID)) {
    manifestErrors.push(
      `GA doc catalog manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
    );
  }
  const expectedSurfaceIds = OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map(
    (surface) => surface.id,
  );
  const actualSurfaceIds = manifest.requiredDocs.map((doc) => doc.id);
  for (const expectedSurfaceId of expectedSurfaceIds) {
    if (!actualSurfaceIds.includes(expectedSurfaceId)) {
      manifestErrors.push(
        `GA doc catalog manifest is missing required surface ${expectedSurfaceId}`,
      );
    }
  }

  const catalog = buildCatalogDocSummary(manifest.catalog);
  const sliceDoc = buildCatalogDocSummary(manifest.sliceDoc);
  const catalogDocPath = resolveDocPath(manifest.catalog.docPath);
  const requiredDocs = existsSync(catalogDocPath)
    ? manifest.requiredDocs.map((doc) => buildRequiredDocSummary(catalogDocPath, doc))
    : manifest.requiredDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        primaryDocPath: resolveDocPath(doc.primaryDocPath),
        primaryDocExists: existsSync(resolveDocPath(doc.primaryDocPath)),
        catalogSectionExists: false,
        owner: doc.owner,
        status: doc.status,
        ownerLine: null,
        statusLine: null,
        missingRequiredSnippets: [...doc.requiredSnippets],
        suspiciousExampleLabels: [],
      }));

  const reportBase = {
    recipeVersion: OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION,
    packVersion: OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
    config,
    blockedFallbackProjectIds: manifest.blockedFallbackProjectIds,
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    catalog,
    sliceDoc,
    requiredDocs,
    writeActionsAttempted: 0 as const,
    verifiedWritesAttempted: 0 as const,
  };
  const errors = [...manifestErrors, ...evaluateGaDocCatalogReport(reportBase)];

  return {
    ...reportBase,
    assertions: {
      ok: errors.length === 0,
      errors,
    },
  };
}

export { CATALOG_REDACTION_SNIPPET };

import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_PILOT_TOOLS,
  AISTROYKA_PROJECT_ID,
} from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_GA_DOC_CATALOG_PACK } from '@memory-os/observability';
import {
  CATALOG_REDACTION_SNIPPET,
  evaluateGaDocCatalogReport,
  gaDocCatalogDrillConfigInputFromEnv,
  OFFICIAL_M14_GA_DOC_CATALOG_RECIPE,
  OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION,
  resolveGaDocCatalogDrillConfig,
  resolveGaDocCatalogDrillConfigFromEnv,
  runGaDocCatalogDrill,
} from './gaDocCatalogDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/ga-doc-catalog/m14-s08-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type GaDocCatalogManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  catalog: {
    docPath: string;
    requiredSnippets: string[];
  };
  sliceDoc: {
    docPath: string;
    requiredSnippets: string[];
  };
  requiredDocs: Array<{
    id: string;
    title: string;
    owner: string;
    status: string;
    catalogSectionHeading: string;
    primaryDocPath: string;
    requiredSnippets: string[];
  }>;
};

function createFixtureCopy(name: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), `${name}-`));
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  return dir;
}

function overwriteJson(relativePath: string, fixtureDir: string, value: unknown): void {
  writeFileSync(resolve(fixtureDir, relativePath), JSON.stringify(value, null, 2));
}

function readJson(relativePath: string, fixtureDir: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, relativePath), 'utf8'));
}

function readMutableManifest(fixtureDir: string): GaDocCatalogManifest {
  return readJson('catalog-manifest.json', fixtureDir) as GaDocCatalogManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: GaDocCatalogManifest;
  catalogDocPath: string;
  sliceDocPath: string;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'docs');
  mkdirSync(docDir, { recursive: true });

  const sourceCatalogPath = resolve(
    WORKSPACE_ROOT,
    'docs/engineering/M14_DOC_CATALOG.md',
  );
  const sourceSlicePath = resolve(
    WORKSPACE_ROOT,
    'docs/engineering/M14_SLICE_08.md',
  );
  const catalogDocPath = resolve(docDir, 'M14_DOC_CATALOG.md');
  const sliceDocPath = resolve(docDir, 'M14_SLICE_08.md');

  writeFileSync(catalogDocPath, readFileSync(sourceCatalogPath, 'utf8'));
  writeFileSync(sliceDocPath, readFileSync(sourceSlicePath, 'utf8'));

  manifest.catalog = {
    ...manifest.catalog,
    docPath: catalogDocPath,
  };
  manifest.sliceDoc = {
    ...manifest.sliceDoc,
    docPath: sliceDocPath,
  };
  overwriteJson('catalog-manifest.json', fixtureDir, manifest);

  return { fixtureDir, manifest, catalogDocPath, sliceDocPath };
}

function mutateDocSection(
  docPath: string,
  heading: string,
  mutate: (section: string) => string,
): void {
  const doc = readFileSync(docPath, 'utf8');
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`## ${escapedHeading}[\\s\\S]*?(?=\\n## |$)`);
  const match = doc.match(pattern);
  if (!match?.[0]) {
    throw new Error(`missing section ${heading}`);
  }
  writeFileSync(docPath, doc.replace(pattern, mutate(match[0])));
}

describe('GA doc catalog drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 08 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE_VERSION).toBe('m14-s08-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.version).toBe('m14-s08-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.packVersion).toBe(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.version,
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.roadmapSections).toEqual(['20.17']);
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.surfaces).toEqual(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map((surface) => surface.id),
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxDocs: 10,
    });
    expect(OFFICIAL_M14_GA_DOC_CATALOG_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount,
    );
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolveGaDocCatalogDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_AISTROYKA_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveGaDocCatalogDrillConfigFromEnv({
        MEMORY_OS_GA_DOC_CATALOG_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_AISTROYKA_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      gaDocCatalogDrillConfigInputFromEnv({
        MEMORY_OS_GA_DOC_CATALOG_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_AISTROYKA_PROJECT_ID: explicitProjectId,
      }),
    ).toMatchObject({
      fixtureDir: FIXTURE_DIR,
      workspaceId,
      projectId: undefined,
    });
  });

  it('rejects the AISTROYKA fallback project_id even when passed explicitly', () => {
    expect(() =>
      resolveGaDocCatalogDrillConfig({
        fixtureDir: FIXTURE_DIR,
        projectId: AISTROYKA_PROJECT_ID,
        workspaceId,
      }),
    ).toThrow(/AISTROYKA fallback project_id/i);
  });

  it('proves checked-in catalog coverage from the canned fixture', async () => {
    const report = await runGaDocCatalogDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.blockedFallbackProjectIds).toContain(AISTROYKA_PROJECT_ID);
    expect(report.modeAToolCount).toBe(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount,
    );
    expect(report.catalog.docExists).toBe(true);
    expect(report.catalog.missingRequiredSnippets).toEqual([]);
    expect(report.sliceDoc.docExists).toBe(true);
    expect(report.sliceDoc.missingRequiredSnippets).toEqual([]);
    expect(report.requiredDocs.map((doc) => doc.id)).toEqual(
      expect.arrayContaining(
        OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map((surface) => surface.id),
      ),
    );
    expect(report.requiredDocs.every((doc) => doc.primaryDocExists)).toBe(true);
    expect(report.requiredDocs.every((doc) => doc.catalogSectionExists)).toBe(true);
    expect(report.requiredDocs.every((doc) => doc.ownerLine === doc.owner)).toBe(true);
    expect(report.requiredDocs.every((doc) => doc.statusLine === doc.status)).toBe(true);
    expect(report.requiredDocs.every((doc) => doc.missingRequiredSnippets.length === 0)).toBe(
      true,
    );
    expect(report.catalog.suspiciousExampleLabels).toEqual([]);
    expect(report.sliceDoc.suspiciousExampleLabels).toEqual([]);
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
  });

  it('fails closed when a required official doc path goes missing', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy('ga-doc-missing-surface');
    manifest.requiredDocs = manifest.requiredDocs.map((doc) =>
      doc.id === 'mcp-mode-a'
        ? { ...doc, primaryDocPath: 'docs/m0/MISSING_MODE_A.md' }
        : doc,
    );
    overwriteJson('catalog-manifest.json', fixtureDir, manifest);

    const report = await runGaDocCatalogDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining(['required doc is missing for surface mcp-mode-a']),
    );
  });

  it('fails closed when a catalog section loses its owner and status', async () => {
    const { fixtureDir, catalogDocPath } = prepareMutableFixtureCopy(
      'ga-doc-owner-status',
    );
    mutateDocSection(catalogDocPath, 'MCP Mode A', (section) =>
      section.replace('Owner: Platform owner', 'Owner:').replace(
        'Status: current official',
        'Status:',
      ),
    );

    const report = await runGaDocCatalogDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'catalog section is missing Owner for surface mcp-mode-a',
        'catalog section is missing Status for surface mcp-mode-a',
      ]),
    );
  });

  it('fails closed when the catalog includes a token example', async () => {
    const { fixtureDir, catalogDocPath } = prepareMutableFixtureCopy(
      'ga-doc-token-leak',
    );
    mutateDocSection(catalogDocPath, 'Documentation contract', (section) => {
      return `${section}\n\nRaw example to avoid: {"token":"live-secret-token"}\n`;
    });

    const report = await runGaDocCatalogDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'GA doc catalog includes suspicious examples (token-json-example)',
      ]),
    );
    expect(CATALOG_REDACTION_SNIPPET.length).toBeGreaterThan(0);
  });

  it('fails closed when the AISTROYKA fallback block is removed', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy('ga-doc-aistroyka');
    manifest.blockedFallbackProjectIds = [];
    overwriteJson('catalog-manifest.json', fixtureDir, manifest);

    const report = await runGaDocCatalogDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        `GA doc catalog manifest must block AISTROYKA fallback ${AISTROYKA_PROJECT_ID}`,
        `GA doc catalog must block AISTROYKA fallback ${AISTROYKA_PROJECT_ID}`,
      ]),
    );
  });

  it('detects ChatGPT Mode A drift and verified-write drift against the pack hard limit', async () => {
    const report = await runGaDocCatalogDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });
    const errors = evaluateGaDocCatalogReport({
      ...report,
      modeAToolCount: 6,
      verifiedWritesAttempted: 1,
    });

    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'ChatGPT Mode A tool count changed (6 !== 7)',
        'GA doc drill attempted verified-memory writes (1)',
      ]),
    );
  });
});

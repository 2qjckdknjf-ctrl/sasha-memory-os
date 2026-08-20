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
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_PRIVACY_SLA_PACK } from '@memory-os/observability';
import {
  evaluatePrivacySlaReport,
  OFFICIAL_M14_PRIVACY_SLA_RECIPE,
  OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION,
  privacySlaDrillConfigInputFromEnv,
  REQUIRED_CONNECTOR_FAMILIES,
  resolvePrivacySlaDrillConfig,
  resolvePrivacySlaDrillConfigFromEnv,
  runPrivacySlaDrill,
  TELEMETRY_HYGIENE_SNIPPET,
} from './privacySlaDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/privacy-sla/m14-s06-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type PrivacySlaManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  slaPaths: Array<{
    id: string;
    title: string;
    route: string;
    requestType?: string | null;
    owner: string;
    deadline: string;
    docPath: string;
    sectionHeading: string;
    explicitProjectIdRequired: boolean;
    metadataOnlyAudit: boolean;
    connectorDerivedCoverage: boolean;
  }>;
  connectorCoverage: {
    docPath: string;
    sectionHeading: string;
    connectorFamilies: string[];
    reuseSurfaces: string[];
  };
  telemetryHygiene: {
    docPath: string;
    sectionHeading: string;
    snippet: string;
  };
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

function readMutableManifest(fixtureDir: string): PrivacySlaManifest {
  return readJson('sla-manifest.json', fixtureDir) as PrivacySlaManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: PrivacySlaManifest;
  docPath: string;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'docs');
  mkdirSync(docDir, { recursive: true });
  const sourceDocPath = resolve(
    WORKSPACE_ROOT,
    'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
  );
  const targetDocPath = resolve(docDir, 'EXPORT_DELETION_SLAS.md');
  writeFileSync(targetDocPath, readFileSync(sourceDocPath, 'utf8'));
  manifest.slaPaths = manifest.slaPaths.map((path) => ({
    ...path,
    docPath: targetDocPath,
  }));
  manifest.connectorCoverage = {
    ...manifest.connectorCoverage,
    docPath: targetDocPath,
  };
  manifest.telemetryHygiene = {
    ...manifest.telemetryHygiene,
    docPath: targetDocPath,
  };
  overwriteJson('sla-manifest.json', fixtureDir, manifest);
  return { fixtureDir, manifest, docPath: targetDocPath };
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

describe('privacy SLA drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 06 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE_VERSION).toBe('m14-s06-v1');
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.version).toBe('m14-s06-v1');
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.packVersion).toBe(
      OFFICIAL_M14_PRIVACY_SLA_PACK.version,
    );
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.roadmapSections).toEqual([
      '16.6',
      '16.7',
      '20.17',
    ]);
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.slaPaths).toEqual(
      OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.map((path) => path.id),
    );
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxSlaPaths: 4,
    });
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount).toBe(7);
    expect(OFFICIAL_M14_PRIVACY_SLA_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount,
    );
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolvePrivacySlaDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_DEFAULT_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolvePrivacySlaDrillConfigFromEnv({
        MEMORY_OS_PRIVACY_SLA_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      privacySlaDrillConfigInputFromEnv({
        MEMORY_OS_PRIVACY_SLA_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toMatchObject({
      fixtureDir: FIXTURE_DIR,
      workspaceId,
      projectId: undefined,
    });
  });

  it('proves checked-in SLAs, connector coverage, and telemetry hygiene from the canned fixture', async () => {
    const report = await runPrivacySlaDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.modeAToolCount).toBe(
      OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount,
    );
    expect(report.slaPaths.map((path) => path.id)).toEqual(
      expect.arrayContaining([
        'owner-export',
        'privacy-deletion',
        'privacy-correction',
        'privacy-retraction',
      ]),
    );
    expect(report.slaPaths.every((path) => path.docExists)).toBe(true);
    expect(report.slaPaths.every((path) => path.ownerLine === path.owner)).toBe(true);
    expect(report.slaPaths.every((path) => path.deadlineLine === path.deadline)).toBe(true);
    expect(
      report.slaPaths
        .filter((path) => path.explicitProjectIdRequired)
        .every((path) => path.hasExplicitProjectIdNote),
    ).toBe(true);
    expect(
      report.slaPaths
        .filter((path) => path.metadataOnlyAudit)
        .every((path) => path.hasMetadataOnlyAuditNote),
    ).toBe(true);
    expect(
      report.slaPaths
        .filter((path) => path.connectorDerivedCoverage)
        .every((path) => path.hasConnectorDerivedCoverageNote),
    ).toBe(true);
    expect(report.connectorCoverage.missingConnectorFamilies).toEqual([]);
    expect(report.connectorCoverage.connectorFamiliesPresent).toEqual(
      expect.arrayContaining([...REQUIRED_CONNECTOR_FAMILIES]),
    );
    expect(report.connectorCoverage.missingReuseSurfaces).toEqual([]);
    expect(report.telemetryHygiene.snippetPresent).toBe(true);
    expect(report.telemetryHygiene.suspiciousExampleLabels).toEqual([]);
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
  });

  it('fails closed when a required SLA loses its owner and deadline', async () => {
    const { fixtureDir, manifest, docPath } = prepareMutableFixtureCopy(
      'privacy-sla-owner-deadline',
    );
    manifest.slaPaths = manifest.slaPaths.map((path) =>
      path.id === 'privacy-deletion'
        ? { ...path, owner: '', deadline: '' }
        : path,
    );
    overwriteJson('sla-manifest.json', fixtureDir, manifest);
    mutateDocSection(docPath, 'Deletion / forget SLA', (section) =>
      section
        .replace('Owner: Privacy owner', 'Owner:')
        .replace('Deadline: 30d from validated owner request', 'Deadline:'),
    );

    const report = await runPrivacySlaDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'privacy SLA manifest privacy-deletion is missing an owner',
        'privacy SLA manifest privacy-deletion is missing a deadline',
        'privacy SLA section privacy-deletion is missing an Owner line',
        'privacy SLA section privacy-deletion is missing a Deadline line',
      ]),
    );
  });

  it('fails closed when connector-derived coverage drops a required family', async () => {
    const { fixtureDir, docPath } = prepareMutableFixtureCopy(
      'privacy-sla-connector-coverage',
    );
    mutateDocSection(docPath, 'Connector-derived coverage', (section) =>
      section.replace('- Apple-transferred-object tombstones remain on\n', '- ').replace(
        'Apple transferred objects',
        'Transferred objects',
      ),
    );

    const report = await runPrivacySlaDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'connector-derived coverage is missing families (Apple transferred objects)',
      ]),
    );
  });

  it('fails closed when telemetry guidance includes payload examples', async () => {
    const { fixtureDir, docPath } = prepareMutableFixtureCopy(
      'privacy-sla-telemetry-leak',
    );
    mutateDocSection(docPath, 'Telemetry hygiene', (section) => {
      return `${section}\n\nRaw example to avoid: {"reason":"delete my private family message"}\n`;
    });

    const report = await runPrivacySlaDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'telemetry hygiene section includes suspicious examples (privacy-reason-example)',
      ]),
    );
    expect(report.telemetryHygiene.snippetPresent).toBe(true);
    expect(TELEMETRY_HYGIENE_SNIPPET.length).toBeGreaterThan(0);
  });

  it('detects ChatGPT Mode A drift against the pack hard limit', async () => {
    const report = await runPrivacySlaDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });
    const errors = evaluatePrivacySlaReport({
      ...report,
      modeAToolCount: 6,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount,
    );
    expect(errors).toContain('ChatGPT Mode A tool count changed (6 !== 7)');
  });
});

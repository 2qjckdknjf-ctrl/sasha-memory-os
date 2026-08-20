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
  DEFAULT_PROJECT_ID,
} from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK } from '@memory-os/observability';
import {
  evaluateFirstHourOnboardingReport,
  firstHourOnboardingDrillConfigInputFromEnv,
  FIRST_HOUR_ONBOARDING_REDACTION_SNIPPET,
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE,
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION,
  resolveFirstHourOnboardingDrillConfig,
  resolveFirstHourOnboardingDrillConfigFromEnv,
  runFirstHourOnboardingDrill,
} from './firstHourOnboardingDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/first-hour-onboarding/m14-s09-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type FirstHourOnboardingManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  guide: {
    docPath: string;
    requiredSnippets: string[];
  };
  sliceDoc: {
    docPath: string;
    requiredSnippets: string[];
  };
  requiredSteps: Array<{
    id: string;
    title: string;
    owner: string;
    status: string;
    guideSectionHeading: string;
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

function readMutableManifest(fixtureDir: string): FirstHourOnboardingManifest {
  return readJson('onboarding-manifest.json', fixtureDir) as FirstHourOnboardingManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: FirstHourOnboardingManifest;
  guideDocPath: string;
  sliceDocPath: string;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'docs');
  mkdirSync(docDir, { recursive: true });

  const sourceGuidePath = resolve(WORKSPACE_ROOT, 'docs/engineering/ONBOARDING.md');
  const sourceSlicePath = resolve(WORKSPACE_ROOT, 'docs/engineering/M14_SLICE_09.md');
  const guideDocPath = resolve(docDir, 'ONBOARDING.md');
  const sliceDocPath = resolve(docDir, 'M14_SLICE_09.md');

  writeFileSync(guideDocPath, readFileSync(sourceGuidePath, 'utf8'));
  writeFileSync(sliceDocPath, readFileSync(sourceSlicePath, 'utf8'));

  manifest.guide = {
    ...manifest.guide,
    docPath: guideDocPath,
  };
  manifest.sliceDoc = {
    ...manifest.sliceDoc,
    docPath: sliceDocPath,
  };
  overwriteJson('onboarding-manifest.json', fixtureDir, manifest);

  return { fixtureDir, manifest, guideDocPath, sliceDocPath };
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

describe('first-hour onboarding drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 09 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE_VERSION).toBe('m14-s09-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.version).toBe('m14-s09-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.packVersion).toBe(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.version,
    );
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.roadmapSections).toEqual([
      '20.17',
    ]);
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.steps).toEqual(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map((step) => step.id),
    );
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxSteps: 7,
    });
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
      requireStepOwner: true,
      requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
      ignoreDefaultProjectIdEnv: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      allowProductionSqlApply: false,
      allowLiveOnboarding: false,
      allowNewUi: false,
      allowNewVendor: false,
      logPayloadBodies: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
    );
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolveFirstHourOnboardingDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_DEFAULT_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveFirstHourOnboardingDrillConfigFromEnv({
        MEMORY_OS_FIRST_HOUR_ONBOARDING_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      firstHourOnboardingDrillConfigInputFromEnv({
        MEMORY_OS_FIRST_HOUR_ONBOARDING_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toMatchObject({
      fixtureDir: FIXTURE_DIR,
      workspaceId,
      projectId: undefined,
    });
  });

  it('rejects the AISTROYKA fallback project_id even when passed explicitly', () => {
    expect(() =>
      resolveFirstHourOnboardingDrillConfig({
        fixtureDir: FIXTURE_DIR,
        projectId: DEFAULT_PROJECT_ID,
        workspaceId,
      }),
    ).toThrow(/AISTROYKA fallback project_id/i);
  });

  it('proves checked-in onboarding coverage from the canned fixture', async () => {
    const report = await runFirstHourOnboardingDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.blockedFallbackProjectIds).toContain(DEFAULT_PROJECT_ID);
    expect(report.modeAToolCount).toBe(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
    );
    expect(report.guide.docExists).toBe(true);
    expect(report.guide.missingRequiredSnippets).toEqual([]);
    expect(report.sliceDoc.docExists).toBe(true);
    expect(report.sliceDoc.missingRequiredSnippets).toEqual([]);
    expect(report.requiredSteps.map((step) => step.id)).toEqual(
      expect.arrayContaining(
        OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map((step) => step.id),
      ),
    );
    expect(report.requiredSteps.every((step) => step.guideSectionExists)).toBe(true);
    expect(report.requiredSteps.every((step) => step.ownerLine === step.owner)).toBe(true);
    expect(report.requiredSteps.every((step) => step.statusLine === step.status)).toBe(true);
    expect(
      report.requiredSteps.every((step) => step.missingRequiredSnippets.length === 0),
    ).toBe(true);
    expect(report.guide.suspiciousExampleLabels).toEqual([]);
    expect(report.sliceDoc.suspiciousExampleLabels).toEqual([]);
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
  });

  it('fails closed when a required onboarding step goes missing', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'first-hour-onboarding-missing-step',
    );
    manifest.requiredSteps = manifest.requiredSteps.filter(
      (step) => step.id !== 'connect-cursor-mcp',
    );
    overwriteJson('onboarding-manifest.json', fixtureDir, manifest);

    const report = await runFirstHourOnboardingDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'first-hour onboarding manifest is missing required step connect-cursor-mcp',
      ]),
    );
  });

  it('fails closed when a guide step loses its owner and status', async () => {
    const { fixtureDir, guideDocPath } = prepareMutableFixtureCopy(
      'first-hour-onboarding-owner-status',
    );
    mutateDocSection(guideDocPath, 'Capture one memory', (section) =>
      section.replace('Owner: Platform owner', 'Owner:').replace(
        'Status: current official',
        'Status:',
      ),
    );

    const report = await runFirstHourOnboardingDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'guide section is missing Owner for step capture-one-memory',
        'guide section is missing Status for step capture-one-memory',
      ]),
    );
  });

  it('fails closed when the guide includes a token example', async () => {
    const { fixtureDir, guideDocPath } = prepareMutableFixtureCopy(
      'first-hour-onboarding-token-leak',
    );
    mutateDocSection(guideDocPath, 'Contract', (section) => {
      return `${section}\n\nRaw example to avoid: {"token":"live-secret-token"}\n`;
    });

    const report = await runFirstHourOnboardingDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'first-hour onboarding guide includes suspicious examples (token-json-example)',
      ]),
    );
    expect(FIRST_HOUR_ONBOARDING_REDACTION_SNIPPET.length).toBeGreaterThan(0);
  });

  it('fails closed when the AISTROYKA fallback block is removed', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'first-hour-onboarding-aistroyka',
    );
    manifest.blockedFallbackProjectIds = [];
    overwriteJson('onboarding-manifest.json', fixtureDir, manifest);

    const report = await runFirstHourOnboardingDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        `first-hour onboarding manifest must block AISTROYKA fallback ${DEFAULT_PROJECT_ID}`,
      ]),
    );
  });

  it('detects ChatGPT Mode A drift and verified-write drift against the pack hard limit', async () => {
    const report = await runFirstHourOnboardingDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });
    const errors = evaluateFirstHourOnboardingReport({
      ...report,
      modeAToolCount: 6,
      verifiedWritesAttempted: 1,
    });

    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'ChatGPT Mode A tool count changed (6 !== 7)',
        'first-hour onboarding drill attempted verified-memory writes (1)',
      ]),
    );
  });
});

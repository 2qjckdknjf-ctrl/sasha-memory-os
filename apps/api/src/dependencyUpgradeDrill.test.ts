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
import { OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK } from '@memory-os/observability';
import {
  dependencyUpgradeDrillConfigInputFromEnv,
  evaluateDependencyUpgradeReport,
  OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE,
  OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION,
  resolveDependencyUpgradeDrillConfig,
  resolveDependencyUpgradeDrillConfigFromEnv,
  runDependencyUpgradeDrill,
  TELEMETRY_HYGIENE_SNIPPET,
} from './dependencyUpgradeDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/dependency-upgrade/m14-s07-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type DependencyUpgradeManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  intake: {
    docPath: string;
    sectionHeading: string;
    owner: string;
    rollback: string;
    requiredSnippets: string[];
  };
  controls: Array<{
    id: string;
    title: string;
    owner: string;
    docPath: string;
    sectionHeading: string;
    requiredSnippets: string[];
  }>;
  protocolEvidence: Array<{
    title: string;
    path: string;
    expectedVersions: string[];
    adrPaths: string[];
    contractEvidence: string[];
  }>;
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

function readMutableManifest(fixtureDir: string): DependencyUpgradeManifest {
  return readJson('policy-manifest.json', fixtureDir) as DependencyUpgradeManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: DependencyUpgradeManifest;
  docPath: string;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'docs');
  mkdirSync(docDir, { recursive: true });
  const sourceDocPath = resolve(
    WORKSPACE_ROOT,
    'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md',
  );
  const targetDocPath = resolve(docDir, 'DEPENDENCY_UPGRADE_POLICY.md');
  writeFileSync(targetDocPath, readFileSync(sourceDocPath, 'utf8'));
  manifest.intake = {
    ...manifest.intake,
    docPath: targetDocPath,
  };
  manifest.controls = manifest.controls.map((control) => ({
    ...control,
    docPath: targetDocPath,
  }));
  manifest.telemetryHygiene = {
    ...manifest.telemetryHygiene,
    docPath: targetDocPath,
  };
  overwriteJson('policy-manifest.json', fixtureDir, manifest);
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

describe('dependency upgrade drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 07 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE_VERSION).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.version).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.packVersion).toBe(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.version,
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.roadmapSections).toEqual(['20.17']);
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.controls).toEqual(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.map((control) => control.id),
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxControls: 7,
    });
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount).toBe(7);
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount,
    );
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolveDependencyUpgradeDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_AISTROYKA_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveDependencyUpgradeDrillConfigFromEnv({
        MEMORY_OS_DEPENDENCY_UPGRADE_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_AISTROYKA_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      dependencyUpgradeDrillConfigInputFromEnv({
        MEMORY_OS_DEPENDENCY_UPGRADE_FIXTURE_DIR: FIXTURE_DIR,
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
      resolveDependencyUpgradeDrillConfig({
        fixtureDir: FIXTURE_DIR,
        projectId: AISTROYKA_PROJECT_ID,
        workspaceId,
      }),
    ).toThrow(/AISTROYKA fallback project_id/i);
  });

  it('proves checked-in policy, protocol evidence, and telemetry hygiene from the canned fixture', async () => {
    const report = await runDependencyUpgradeDrill({
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
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount,
    );
    expect(report.intake.ownerLine).toBe(report.intake.owner);
    expect(report.intake.rollbackLine).toBe(report.intake.rollback);
    expect(report.intake.missingRequiredSnippets).toEqual([]);
    expect(report.controls.map((control) => control.id)).toEqual(
      expect.arrayContaining([
        'upgrade-owner',
        'rollback-note',
        'contract-and-smoke-gate',
        'protocol-adr-and-contract-tests',
        'mode-a-seven-tools',
        'explicit-project-id-no-default-fallback',
        'no-secret-payload-or-verified-write-leaks',
      ]),
    );
    expect(report.controls.every((control) => control.docExists)).toBe(true);
    expect(report.controls.every((control) => control.sectionExists)).toBe(true);
    expect(report.controls.every((control) => control.ownerLine === control.owner)).toBe(true);
    expect(report.controls.every((control) => control.missingRequiredSnippets.length === 0)).toBe(
      true,
    );
    expect(report.protocolEvidence.every((evidence) => evidence.fileExists)).toBe(true);
    expect(
      report.protocolEvidence.every(
        (evidence) =>
          JSON.stringify(evidence.actualVersions) === JSON.stringify(evidence.expectedVersions),
      ),
    ).toBe(true);
    expect(
      report.protocolEvidence.every((evidence) => evidence.missingAdrPaths.length === 0),
    ).toBe(true);
    expect(
      report.protocolEvidence.every(
        (evidence) => evidence.missingContractEvidence.length === 0,
      ),
    ).toBe(true);
    expect(report.telemetryHygiene.snippetPresent).toBe(true);
    expect(report.telemetryHygiene.suspiciousExampleLabels).toEqual([]);
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
  });

  it('fails closed when intake loses its owner and rollback note', async () => {
    const { fixtureDir, manifest, docPath } = prepareMutableFixtureCopy(
      'dependency-upgrade-owner-rollback',
    );
    manifest.intake = {
      ...manifest.intake,
      owner: '',
      rollback: '',
    };
    overwriteJson('policy-manifest.json', fixtureDir, manifest);
    mutateDocSection(docPath, 'Intake', (section) =>
      section
        .replace('Owner: Platform owner', 'Owner:')
        .replace(
          'Rollback: Revert the dependency change and `pnpm-lock.yaml`, rerun `pnpm typecheck`, `pnpm test`, and `scripts/smoke-mcp-chatgpt.sh`, and never apply SQL to production as part of rollback.',
          'Rollback:',
        ),
    );

    const report = await runDependencyUpgradeDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'dependency upgrade intake manifest is missing an owner',
        'dependency upgrade intake manifest is missing a rollback note',
        'dependency upgrade intake section is missing an Owner line',
        'dependency upgrade intake section is missing a Rollback line',
      ]),
    );
  });

  it('fails closed when the contract/smoke gate loses a required command', async () => {
    const { fixtureDir, docPath } = prepareMutableFixtureCopy(
      'dependency-upgrade-contract-smoke',
    );
    mutateDocSection(docPath, 'Contract and smoke gate', (section) =>
      section.replace('`scripts/smoke-mcp-chatgpt.sh`', '`scripts/placeholder-smoke.sh`'),
    );

    const report = await runDependencyUpgradeDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'dependency upgrade control contract-and-smoke-gate is missing required snippets (`scripts/smoke-mcp-chatgpt.sh`)',
      ]),
    );
  });

  it('fails closed when protocol evidence drifts without ADR coverage', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'dependency-upgrade-protocol-drift',
    );
    manifest.protocolEvidence = manifest.protocolEvidence.map((evidence) =>
      evidence.title === 'ChatGPT profile contract test'
        ? {
            ...evidence,
            expectedVersions: ['2026-01-01'],
            adrPaths: [],
          }
        : evidence,
    );
    overwriteJson('policy-manifest.json', fixtureDir, manifest);

    const report = await runDependencyUpgradeDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'protocol evidence ChatGPT profile contract test version drift (2025-03-26 !== 2026-01-01)',
        'protocol evidence ChatGPT profile contract test is missing ADR references',
      ]),
    );
  });

  it('fails closed when the AISTROYKA fallback block is removed', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'dependency-upgrade-aistroyka-fallback',
    );
    manifest.blockedFallbackProjectIds = [];
    overwriteJson('policy-manifest.json', fixtureDir, manifest);

    const report = await runDependencyUpgradeDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        `dependency upgrade manifest must block AISTROYKA fallback ${AISTROYKA_PROJECT_ID}`,
        `dependency upgrade policy must block AISTROYKA fallback ${AISTROYKA_PROJECT_ID}`,
      ]),
    );
  });

  it('fails closed when telemetry guidance includes a token example', async () => {
    const { fixtureDir, docPath } = prepareMutableFixtureCopy(
      'dependency-upgrade-telemetry-leak',
    );
    mutateDocSection(docPath, 'Log and CI hygiene', (section) => {
      return `${section}\n\nRaw example to avoid: {"token":"live-secret-token"}\n`;
    });

    const report = await runDependencyUpgradeDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'dependency upgrade control no-secret-payload-or-verified-write-leaks includes suspicious examples (token-json-example)',
        'dependency upgrade telemetry hygiene includes suspicious examples (token-json-example)',
      ]),
    );
    expect(report.telemetryHygiene.snippetPresent).toBe(true);
    expect(TELEMETRY_HYGIENE_SNIPPET.length).toBeGreaterThan(0);
  });

  it('detects ChatGPT Mode A drift against the pack hard limit', async () => {
    const report = await runDependencyUpgradeDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });
    const errors = evaluateDependencyUpgradeReport({
      ...report,
      modeAToolCount: 6,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount,
    );
    expect(errors).toContain('ChatGPT Mode A tool count changed (6 !== 7)');
  });
});

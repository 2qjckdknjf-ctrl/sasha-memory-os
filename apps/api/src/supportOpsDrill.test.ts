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
import { OFFICIAL_M14_SUPPORT_OPS_PACK } from '@memory-os/observability';
import {
  evaluateSupportOpsDrillReport,
  OFFICIAL_M14_SUPPORT_OPS_RECIPE,
  OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION,
  resolveSupportOpsDrillConfig,
  resolveSupportOpsDrillConfigFromEnv,
  runSupportOpsDrill,
  SUPPORT_OPS_REDACTION_SNIPPET,
  supportOpsDrillConfigInputFromEnv,
} from './supportOpsDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/support-ops/m14-s10-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type SupportOpsManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  blockedFallbackProjectIds: string[];
  opsPage: {
    docPath: string;
    requiredSnippets: string[];
    forbiddenSnippets?: string[];
  };
  sliceDoc: {
    docPath: string;
    requiredSnippets: string[];
    forbiddenSnippets?: string[];
  };
  requiredLinks: Array<{
    id: string;
    owner: string;
    kind: 'route' | 'doc';
    target: string;
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

function readMutableManifest(fixtureDir: string): SupportOpsManifest {
  return readJson('ops-manifest.json', fixtureDir) as SupportOpsManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: SupportOpsManifest;
  opsPagePath: string;
  sliceDocPath: string;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'docs');
  mkdirSync(docDir, { recursive: true });

  const sourceOpsPagePath = resolve(WORKSPACE_ROOT, 'apps/web/src/OpsPage.tsx');
  const sourceSlicePath = resolve(WORKSPACE_ROOT, 'docs/engineering/M14_SLICE_10.md');
  const opsPagePath = resolve(docDir, 'OpsPage.tsx');
  const sliceDocPath = resolve(docDir, 'M14_SLICE_10.md');

  writeFileSync(opsPagePath, readFileSync(sourceOpsPagePath, 'utf8'));
  writeFileSync(sliceDocPath, readFileSync(sourceSlicePath, 'utf8'));

  manifest.opsPage = {
    ...manifest.opsPage,
    docPath: opsPagePath,
  };
  manifest.sliceDoc = {
    ...manifest.sliceDoc,
    docPath: sliceDocPath,
  };
  overwriteJson('ops-manifest.json', fixtureDir, manifest);

  return { fixtureDir, manifest, opsPagePath, sliceDocPath };
}

describe('support / ops drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 10 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE_VERSION).toBe('m14-s10-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.version).toBe('m14-s10-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.packVersion).toBe(
      OFFICIAL_M14_SUPPORT_OPS_PACK.version,
    );
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.roadmapSections).toEqual([
      '20.17',
      'RG5 support+ownership',
    ]);
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.supportLinks).toEqual(
      OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map((link) => link.id),
    );
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxSupportLinks: 10,
    });
    expect(OFFICIAL_M14_SUPPORT_OPS_RECIPE.invariants).toMatchObject({
      reuseExistingOpsPage: true,
      actorSwitchingDemoOnly: true,
      requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
      ignoreDefaultProjectIdEnv: true,
      modeAToolCount: 7,
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount,
    );
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolveSupportOpsDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_AISTROYKA_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveSupportOpsDrillConfigFromEnv({
        MEMORY_OS_SUPPORT_OPS_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_AISTROYKA_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      supportOpsDrillConfigInputFromEnv({
        MEMORY_OS_SUPPORT_OPS_FIXTURE_DIR: FIXTURE_DIR,
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
      resolveSupportOpsDrillConfig({
        fixtureDir: FIXTURE_DIR,
        projectId: AISTROYKA_PROJECT_ID,
        workspaceId,
      }),
    ).toThrow(/AISTROYKA fallback project_id/i);
  });

  it('fails closed immediately on explicit missing fixtureDir or manifestPath', () => {
    expect(() =>
      resolveSupportOpsDrillConfig({
        fixtureDir: resolve(FIXTURE_DIR, 'missing-fixture'),
        projectId: explicitProjectId,
        workspaceId,
      }),
    ).toThrow(/support \/ ops fixture directory does not exist/i);

    expect(() =>
      resolveSupportOpsDrillConfig({
        fixtureDir: FIXTURE_DIR,
        manifestPath: 'missing-manifest.json',
        projectId: explicitProjectId,
        workspaceId,
      }),
    ).toThrow(/support \/ ops manifest path does not exist/i);
  });

  it('proves checked-in support links and payload redaction from the canned fixture', async () => {
    const report = await runSupportOpsDrill({
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
      OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount,
    );
    expect(report.opsPage.docExists).toBe(true);
    expect(report.opsPage.missingRequiredSnippets).toEqual([]);
    expect(report.opsPage.forbiddenSnippetsPresent).toEqual([]);
    expect(report.sliceDoc.docExists).toBe(true);
    expect(report.sliceDoc.missingRequiredSnippets).toEqual([]);
    expect(report.requiredLinks.map((link) => link.id)).toEqual(
      expect.arrayContaining(
        OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map((link) => link.id),
      ),
    );
    expect(report.requiredLinks.every((link) => link.presentInOpsPage)).toBe(true);
    expect(report.requiredLinks.every((link) => link.missingRequiredSnippets.length === 0)).toBe(
      true,
    );
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
    expect(report.ownerTokenBypassAttempts).toBe(0);
    expect(report.liveOpsActionsAttempted).toBe(0);
  });

  it('fails closed when a required official link goes missing', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy('support-ops-missing-link');
    manifest.requiredLinks = manifest.requiredLinks.filter((link) => link.id !== 'privacy-route');
    overwriteJson('ops-manifest.json', fixtureDir, manifest);

    const report = await runSupportOpsDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'support / ops manifest is missing required link privacy-route',
      ]),
    );
  });

  it('fails closed when raw payload rendering is reintroduced into the ops page source', async () => {
    const { fixtureDir, opsPagePath } = prepareMutableFixtureCopy('support-ops-payload-leak');
    writeFileSync(
      opsPagePath,
      `${readFileSync(opsPagePath, 'utf8')}
// text: hit.memory?.content
// onExportMemories()
// onUpdateConnectionStatus(connection.id!, 'revoked'
// onSetHitStatus(hit.memory!.id!, 'verified')
// onBulkReviewStatus('verified')
`,
    );

    const report = await runSupportOpsDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    const joinedErrors = report.assertions.errors.join(' ');
    expect(joinedErrors).toContain('hit.memory?.content');
    expect(joinedErrors).toContain('text: hit.memory?.content');
    expect(joinedErrors).toContain('onExportMemories()');
    expect(joinedErrors).toContain("onUpdateConnectionStatus(connection.id!, 'revoked'");
    expect(joinedErrors).toContain("onSetHitStatus(hit.memory!.id!, 'verified')");
    expect(joinedErrors).toContain("onBulkReviewStatus('verified')");
    expect(SUPPORT_OPS_REDACTION_SNIPPET.length).toBeGreaterThan(0);
  });

  it('fails closed when the AISTROYKA fallback block is removed', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy('support-ops-aistroyka');
    manifest.blockedFallbackProjectIds = [];
    overwriteJson('ops-manifest.json', fixtureDir, manifest);

    const report = await runSupportOpsDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        `support / ops manifest must block AISTROYKA fallback ${AISTROYKA_PROJECT_ID}`,
      ]),
    );
  });

  it('detects Mode A drift and write / bypass drift against the pack hard limit', async () => {
    const report = await runSupportOpsDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });
    const errors = evaluateSupportOpsDrillReport({
      ...report,
      modeAToolCount: 6,
      verifiedWritesAttempted: 1,
      ownerTokenBypassAttempts: 1,
      liveOpsActionsAttempted: 1,
    });

    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        'ChatGPT Mode A tool count changed (6 !== 7)',
        'support / ops drill attempted verified-memory writes (1)',
        'support / ops drill attempted owner-token bypass (1)',
        'support / ops drill attempted live ops actions (1)',
      ]),
    );
  });
});

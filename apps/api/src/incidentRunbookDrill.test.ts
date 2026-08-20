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
import { OFFICIAL_M14_INCIDENT_RUNBOOK_PACK } from '@memory-os/observability';
import {
  incidentRunbookDrillConfigInputFromEnv,
  OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE,
  OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION,
  resolveIncidentRunbookDrillConfig,
  resolveIncidentRunbookDrillConfigFromEnv,
  runIncidentRunbookDrill,
} from './incidentRunbookDrill.js';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  '../fixtures/incident-runbooks/m14-s05-v1',
);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const explicitProjectId = '44444444-4444-4444-8444-444444444420';

type IncidentRunbookManifest = {
  manifestVersion: string;
  packVersion: string;
  source: 'fixture-local';
  roadmapSections: string[];
  alerts: Array<{
    id: string;
    owner: string;
    runbookId: string;
  }>;
  runbooks: Array<{
    id: string;
    title: string;
    owner: string;
    docPath: string;
    alertIds: string[];
    writeAdminPaths: string[];
    explicitProjectIdRequired: boolean;
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

function readMutableManifest(fixtureDir: string): IncidentRunbookManifest {
  return readJson('runbook-manifest.json', fixtureDir) as IncidentRunbookManifest;
}

function prepareMutableFixtureCopy(name: string): {
  fixtureDir: string;
  manifest: IncidentRunbookManifest;
} {
  const fixtureDir = createFixtureCopy(name);
  const manifest = readMutableManifest(fixtureDir);
  const docDir = resolve(fixtureDir, 'runbooks');
  mkdirSync(docDir, { recursive: true });

  manifest.runbooks = manifest.runbooks.map((runbook) => {
    const sourcePath = runbook.docPath.startsWith('/')
      ? runbook.docPath
      : resolve(WORKSPACE_ROOT, runbook.docPath);
    const targetPath = resolve(docDir, `${runbook.id}.md`);
    writeFileSync(targetPath, readFileSync(sourcePath, 'utf8'));
    return {
      ...runbook,
      docPath: targetPath,
    };
  });
  overwriteJson('runbook-manifest.json', fixtureDir, manifest);
  return { fixtureDir, manifest };
}

function mutateRunbookDoc(
  manifest: IncidentRunbookManifest,
  runbookId: string,
  mutate: (doc: string) => string,
): void {
  const runbook = manifest.runbooks.find((item) => item.id === runbookId);
  if (!runbook) {
    throw new Error(`missing runbook ${runbookId}`);
  }
  writeFileSync(runbook.docPath, mutate(readFileSync(runbook.docPath, 'utf8')));
}

describe('incident runbook drill harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes the official M14 Slice 05 recipe as versioned and fixture-bounded', () => {
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE_VERSION).toBe('m14-s05-v1');
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.version).toBe('m14-s05-v1');
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.packVersion).toBe(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version,
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.roadmapSections).toEqual([
      '16.4',
      '20.17',
    ]);
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.runbooks).toEqual(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.map((runbook) => runbook.id),
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.alerts).toEqual(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.map((alert) => alert.id),
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.bounds).toMatchObject({
      fixtureOnly: true,
      maxRunbooks: 6,
      maxAlerts: 10,
    });
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_RECIPE.invariants).toMatchObject({
      modeAToolCount: 7,
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('requires an explicit project_id for the bounded drill', () => {
    expect(() =>
      resolveIncidentRunbookDrillConfig({
        fixtureDir: FIXTURE_DIR,
        workspaceId,
      }),
    ).toThrow(/explicit project_id is required/i);
  });

  it('ignores MEMORY_OS_DEFAULT_PROJECT_ID fallback env for the drill fixture', () => {
    expect(() =>
      resolveIncidentRunbookDrillConfigFromEnv({
        MEMORY_OS_INCIDENT_RUNBOOK_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toThrow(/explicit project_id is required/i);
    expect(
      incidentRunbookDrillConfigInputFromEnv({
        MEMORY_OS_INCIDENT_RUNBOOK_FIXTURE_DIR: FIXTURE_DIR,
        MEMORY_OS_WORKSPACE_ID: workspaceId,
        MEMORY_OS_DEFAULT_PROJECT_ID: explicitProjectId,
      }),
    ).toMatchObject({
      fixtureDir: FIXTURE_DIR,
      workspaceId,
      projectId: undefined,
    });
  });

  it('proves checked-in runbooks, alert owners, and rollback/revoke coverage from the canned fixture', async () => {
    const report = await runIncidentRunbookDrill({
      fixtureDir: FIXTURE_DIR,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions).toMatchObject({
      ok: true,
      errors: [],
    });
    expect(report.modeAToolCount).toBe(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants.modeAToolCount,
    );
    expect(report.alerts).toMatchObject({
      totalExpected: 10,
      mappedCount: 10,
      missingIds: [],
      ownerlessIds: [],
      runbooklessIds: [],
    });
    expect(report.runbooks).toHaveLength(6);
    expect(report.runbooks.every((runbook) => runbook.docExists)).toBe(true);
    expect(
      report.runbooks.every((runbook) => runbook.hasRollbackOrRevokeStep),
    ).toBe(true);
    expect(
      report.runbooks.every((runbook) => runbook.hasTelemetryHygieneSection),
    ).toBe(true);
    expect(
      report.runbooks.every((runbook) => runbook.hasExplicitProjectIdNote),
    ).toBe(true);
    expect(
      report.runbooks.every((runbook) => runbook.coveredAlertsPresent),
    ).toBe(true);
    expect(
      report.runbooks.every((runbook) => runbook.suspiciousExampleLabels.length === 0),
    ).toBe(true);
    expect(report.writeActionsAttempted).toBe(0);
    expect(report.verifiedWritesAttempted).toBe(0);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('super-secret');
  });

  it('fails closed when a required runbook loses its owner and rollback/revoke step', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'incident-runbook-owner-rollback',
    );
    manifest.runbooks = manifest.runbooks.map((runbook) =>
      runbook.id === 'key-rotation'
        ? { ...runbook, owner: '' }
        : runbook,
    );
    overwriteJson('runbook-manifest.json', fixtureDir, manifest);
    mutateRunbookDoc(manifest, 'key-rotation', (doc) =>
      doc
        .replace('Owner: Security on-call', 'Owner:')
        .replace(
          /## Rollback \/ revoke[\s\S]*?## Telemetry hygiene/s,
          '## Telemetry hygiene\n\nDo not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.\n',
        ),
    );

    const report = await runIncidentRunbookDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toEqual(
      expect.arrayContaining([
        'incident runbook key-rotation owner mismatch ( !== Security on-call)',
        'incident runbook key-rotation is missing an Owner line',
        'incident runbook key-rotation is missing a rollback/revoke step',
      ]),
    );
  });

  it('fails closed when a required alert mapping is missing', async () => {
    const fixtureDir = createFixtureCopy('incident-runbook-alert-missing');
    const manifest = readMutableManifest(fixtureDir);
    manifest.alerts = manifest.alerts.filter((alert) => alert.id !== 'slo.write.receipt');
    overwriteJson('runbook-manifest.json', fixtureDir, manifest);

    const report = await runIncidentRunbookDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.alerts.missingIds).toContain('slo.write.receipt');
    expect(report.assertions.errors).toContain(
      'incident alert mapping is missing required alert: slo.write.receipt',
    );
  });

  it('fails closed on token or payload examples without echoing the secret value', async () => {
    const { fixtureDir, manifest } = prepareMutableFixtureCopy(
      'incident-runbook-token-leak',
    );
    mutateRunbookDoc(
      manifest,
      'service-role-vault-compromise',
      (doc) => `${doc}\n\nAvoid this bad example: Bearer dont-ever-log-me-1234567890\n`,
    );

    const report = await runIncidentRunbookDrill({
      fixtureDir,
      projectId: explicitProjectId,
      workspaceId,
    });

    expect(report.assertions.ok).toBe(false);
    expect(report.assertions.errors).toContain(
      'incident runbook service-role-vault-compromise leaks sensitive examples (bearer-token-example)',
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('dont-ever-log-me-1234567890');
  });
});

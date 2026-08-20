import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_SUPPORT_OPS_PACK,
  OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 10 support / ops pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION).toBe('m14-s10-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.version).toBe('m14-s10-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.incidentRunbookPackVersion).toBe('m14-s05-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.privacySlaPackVersion).toBe('m14-s06-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.firstHourOnboardingPackVersion).toBe('m14-s09-v1');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.roadmapSections).toEqual([
      '20.17',
      'RG5 support+ownership',
    ]);
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.entryRoute).toBe('/ops');
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      fixtureOnly: true,
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
      logMemoryBodies: false,
      logTokens: false,
      logPayloadBodies: false,
      logExportPayloads: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_SUPPORT_OPS_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official support links and ownership areas', () => {
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'ops-route',
        'slo-pack',
        'alert-routing-runbook',
        'emergency-revoke-runbook',
        'connector-revoke-runbook',
        'privacy-route',
        'privacy-sla-doc',
        'audit-route',
        'connections-route',
        'onboarding-guide',
      ]),
    );
    expect(OFFICIAL_M14_SUPPORT_OPS_PACK.ownership.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'slo-and-error-budgets',
        'revoke-and-rollback',
        'export-and-privacy',
        'on-call-routing',
      ]),
    );
  });

  it('documents bounded scope and keeps the ops source metadata-only', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_10.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    const opsPage = readFileSync(resolve(root, 'apps/web/src/OpsPage.tsx'), 'utf8');

    expect(sliceDoc).toContain('Official pack version: `m14-s10-v1`');
    expect(sliceDoc).toContain('Roadmap sections: `20.17`, `RG5 support+ownership`');
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(sliceDoc).toMatch(/current Control Center `\/ops` page/i);
    expect(sliceDoc).toMatch(/ChatGPT Mode A stays exactly 7 tools/i);
    expect(sliceDoc).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` is ignored/i);
    expect(sliceDoc).toMatch(/no AISTROYKA fallback/i);
    expect(sliceDoc).toMatch(/no owner-token bypass/i);
    expect(sliceDoc).toMatch(/no verified-memory writes/i);
    expect(sliceDoc).toMatch(/no tokens, memory bodies, or export payloads/i);
    expect(sliceDoc).toMatch(/No production SQL apply is part of this work\./);

    expect(opsPage).toContain('OFFICIAL_M14_SUPPORT_OPS_PACK.version');
    expect(opsPage).toContain('OFFICIAL_M14_SUPPORT_OPS_PACK.supportLinks.map');
    expect(opsPage).toContain('Actor switching below stays demo-only');
    expect(opsPage).toContain('Redacted on /ops');
    expect(opsPage).not.toContain('JSON.stringify(jobLookup, null, 2)');
    expect(opsPage).not.toContain("candidate.content.slice(0, 240)");
    expect(opsPage).not.toContain("hit.memory?.content ?? ''");
    expect(opsPage).not.toContain('item.content');
    expect(opsPage).not.toContain('connection.vaultRef');

    expect(docsReadme).toContain(
      '[engineering/M14_SLICE_10.md](engineering/M14_SLICE_10.md)',
    );
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK,
  OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 09 first-hour onboarding pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION).toBe('m14-s09-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.version).toBe('m14-s09-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.privacySlaPackVersion).toBe(
      'm14-s06-v1',
    );
    expect(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.dependencyUpgradePolicyPackVersion,
    ).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.gaDocCatalogPackVersion).toBe(
      'm14-s08-v1',
    );
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.roadmapSections).toEqual([
      '20.17',
    ]);
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      fixtureOnly: true,
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
      logMemoryBodies: false,
      logTokens: false,
      logPayloadBodies: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected first-hour onboarding steps and owners', () => {
    expect(OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'connect-chatgpt-mode-a',
        'connect-cursor-mcp',
        'open-control-center',
        'pick-explicit-project',
        'capture-one-memory',
        'search-read-after-write',
        'find-export-privacy-runbooks',
      ]),
    );
    expect(
      OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.steps.find(
        (item) => item.id === 'find-export-privacy-runbooks',
      ),
    ).toMatchObject({
      ownerRole: 'Privacy owner',
      surface: 'privacy',
    });
  });

  it('documents the bounded first-hour path and non-production exclusions', () => {
    const guide = readFileSync(resolve(root, 'docs/engineering/ONBOARDING.md'), 'utf8');
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_09.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');

    expect(guide).toContain('Version: `m14-s09-v1`');
    expect(guide).toContain('Roadmap section: `20.17`');
    expect(guide).toMatch(/## Contract/);
    expect(guide).toMatch(/## Connect ChatGPT Mode A/);
    expect(guide).toMatch(/## Connect Cursor MCP/);
    expect(guide).toMatch(/## Open Control Center/);
    expect(guide).toMatch(/## Pick explicit project/);
    expect(guide).toMatch(/## Capture one memory/);
    expect(guide).toMatch(/## Search and read-after-write/);
    expect(guide).toMatch(/## Find export, privacy, and runbooks/);
    expect(guide).toMatch(/exactly 7 tools/i);
    expect(guide).toMatch(/explicit `project_id`/i);
    expect(guide).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` is ignored/i);
    expect(guide).toMatch(/AISTROYKA fallback/i);
    expect(guide).toMatch(
      /Do not use `memory\.store_decision` or `memory\.set_status` as part of onboarding\./,
    );
    expect(guide).toMatch(/Production SQL apply is not part of onboarding\./);
    expect(guide).toMatch(/not the onboarding flow/i);
    expect(guide).not.toMatch(/"token"\s*:/i);
    expect(guide).not.toMatch(/"payload"\s*:/i);
    expect(guide).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/i);

    expect(sliceDoc).toContain('Official pack version: `m14-s09-v1`');
    expect(sliceDoc).toContain('Roadmap section: `20.17`');
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(sliceDoc).toMatch(/ChatGPT Mode A stays exactly 7 tools/i);
    expect(sliceDoc).toMatch(/explicit `project_id` stays required/i);
    expect(sliceDoc).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` is ignored/i);
    expect(sliceDoc).toMatch(/no AISTROYKA fallback/i);
    expect(sliceDoc).toMatch(/no verified-memory writes as part of onboarding/i);
    expect(sliceDoc).toMatch(/No SQL migration is required/i);
    expect(sliceDoc).toMatch(/No production SQL apply is part of this work/i);
    expect(sliceDoc).toMatch(/no live onboarding against production/i);

    expect(docsReadme).toContain(
      '[engineering/ONBOARDING.md](engineering/ONBOARDING.md)',
    );
  });
});

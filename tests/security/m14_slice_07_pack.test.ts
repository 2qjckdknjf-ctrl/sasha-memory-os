import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK,
  OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 07 dependency upgrade policy pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.version).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.drRestoreDrillPackVersion).toBe(
      'm14-s04-v1',
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.incidentRunbookPackVersion).toBe(
      'm14-s05-v1',
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.privacySlaPackVersion).toBe(
      'm14-s06-v1',
    );
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.roadmapSections).toEqual(['20.17']);
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      fixtureOnly: true,
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
      logMemoryBodies: false,
      logTokens: false,
      logUpgradePayloads: false,
      logCiSecrets: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official dependency upgrade controls', () => {
    expect(OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.map((item) => item.id)).toEqual(
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
    expect(
      OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK.controls.find(
        (item) => item.id === 'protocol-adr-and-contract-tests',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        'docs/adr/ADR-001-canonical-memory.md',
        'apps/mcp-gateway/src/profile.test.ts',
        'apps/mcp-gateway/src/rpc.test.ts',
      ]),
    );
  });

  it('documents bounded scope and non-production exclusions', () => {
    const doc = readFileSync(resolve(root, 'docs/engineering/M14_SLICE_07.md'), 'utf8');
    const policy = readFileSync(
      resolve(root, 'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md'),
      'utf8',
    );
    expect(doc).toContain('Official pack version: `m14-s07-v1`');
    expect(doc).toContain('Roadmap section: `20.17`');
    expect(doc).toMatch(/## In scope/);
    expect(doc).toMatch(/## Out of scope/);
    expect(doc).toMatch(/names an owner/i);
    expect(doc).toMatch(/names a rollback note/i);
    expect(doc).toMatch(/contract tests and smoke remain required gates/i);
    expect(doc).toMatch(/requires ADR references/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/explicit `project_id`/i);
    expect(doc).toMatch(/MEMORY_OS_DEFAULT_PROJECT_ID is ignored/i);
    expect(doc).toMatch(/no AISTROYKA fallback/i);
    expect(doc).toMatch(/no owner-token bypass/i);
    expect(doc).toMatch(/no verified-memory writes/i);
    expect(doc).toMatch(/production SQL apply is never implied/i);
    expect(doc).toMatch(/no live mass upgrade/i);
    expect(policy).toMatch(/pnpm typecheck/);
    expect(policy).toMatch(/pnpm test/);
    expect(policy).toMatch(/pnpm audit --audit-level=critical/);
    expect(policy).toMatch(/scripts\/smoke-mcp-chatgpt\.sh/);
    expect(policy).toMatch(/Do not silently bump `protocolVersion`\./);
    expect(policy).toMatch(/docs\/adr\/ADR-001-canonical-memory\.md/);
    expect(policy).toMatch(/docs\/adr\/ADR-005-secrets-and-environments\.md/);
    expect(policy).toMatch(/ChatGPT Mode A stays exactly 7 tools\./);
    expect(policy).toMatch(/Do not fall back to AISTROYKA/);
    expect(policy).toMatch(/No verified-memory writes as part of a dependency upgrade\./);
    expect(policy).toMatch(
      /Do not log tokens, secrets, memory bodies, or dependency-upgrade payloads in CI output, upgrade notes, or validator output\./,
    );
  });
});

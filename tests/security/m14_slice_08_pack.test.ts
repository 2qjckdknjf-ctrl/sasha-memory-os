import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_GA_DOC_CATALOG_PACK,
  OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 08 GA documentation catalog pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION).toBe('m14-s08-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.version).toBe('m14-s08-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.boundedSoakRecipeVersion).toBe(
      'm14-s02-v1',
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.drRestoreDrillPackVersion).toBe(
      'm14-s04-v1',
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.incidentRunbookPackVersion).toBe(
      'm14-s05-v1',
    );
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.privacySlaPackVersion).toBe(
      'm14-s06-v1',
    );
    expect(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.dependencyUpgradePolicyPackVersion,
    ).toBe('m14-s07-v1');
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.roadmapSections).toEqual(['20.17']);
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      fixtureOnly: true,
      requireCatalogIndex: true,
      requireDocOwner: true,
      requireDocStatus: true,
      failClosedWhenDocMissing: true,
      failClosedWhenCatalogLeaksTokens: true,
      failClosedWhenCatalogLeaksPayloads: true,
      modeAToolCount: 7,
      ignoreDefaultProjectIdEnv: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      allowProductionSqlApply: false,
      logMemoryBodies: false,
      logTokens: false,
      allowCatalogPayloadExamples: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official documentation surfaces', () => {
    expect(OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'slo-error-budgets',
        'bounded-soak',
        'security-review',
        'dr-restore-drill',
        'incident-runbooks',
        'export-deletion-slas',
        'dependency-upgrade-policy',
        'rls-matrix',
        'secrets-policy',
        'mcp-mode-a',
      ]),
    );
    expect(
      OFFICIAL_M14_GA_DOC_CATALOG_PACK.surfaces.find(
        (item) => item.id === 'incident-runbooks',
      )?.linkedPaths,
    ).toEqual(
      expect.arrayContaining([
        'docs/engineering/runbooks/',
        'docs/engineering/runbooks/alert-ownership-and-routing.md',
      ]),
    );
  });

  it('documents bounded scope, current official links, and non-production exclusions', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_08.md'),
      'utf8',
    );
    const catalog = readFileSync(
      resolve(root, 'docs/engineering/M14_DOC_CATALOG.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');

    expect(sliceDoc).toContain('Official pack version: `m14-s08-v1`');
    expect(sliceDoc).toContain('Roadmap section: `20.17`');
    expect(sliceDoc).toMatch(/## In scope/);
    expect(sliceDoc).toMatch(/## Out of scope/);
    expect(sliceDoc).toMatch(/every required surface has a checked-in owner and status/i);
    expect(sliceDoc).toMatch(/exactly 7 tools/i);
    expect(sliceDoc).toMatch(/explicit `project_id`/i);
    expect(sliceDoc).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` is ignored/i);
    expect(sliceDoc).toMatch(/no AISTROYKA fallback/i);
    expect(sliceDoc).toMatch(/no owner-token bypass/i);
    expect(sliceDoc).toMatch(/no verified-memory writes/i);
    expect(sliceDoc).toMatch(/no token or payload examples in the catalog/i);
    expect(sliceDoc).toMatch(/No SQL migration is required/i);
    expect(sliceDoc).toMatch(/No production SQL apply is part of this work/i);

    expect(catalog).toContain('Version: `m14-s08-v1`');
    expect(catalog).toContain('Roadmap section: `20.17`');
    expect(catalog).toMatch(/## Documentation contract/);
    expect(catalog).toMatch(/GA candidate docs must be findable and versioned/i);
    expect(catalog).toMatch(/Every catalogued surface names an owner and a status/i);
    expect(catalog).toMatch(/ChatGPT Mode A stays exactly 7 tools\./);
    expect(catalog).toMatch(/`MEMORY_OS_DEFAULT_PROJECT_ID` is ignored/i);
    expect(catalog).toMatch(/Do not fall back to AISTROYKA/i);
    expect(catalog).toMatch(/Production SQL apply is not implied by these docs\./);
    expect(catalog).toMatch(/## SLO \+ error budgets/);
    expect(catalog).toMatch(/## Bounded soak/);
    expect(catalog).toMatch(/## Security review/);
    expect(catalog).toMatch(/## DR restore drill/);
    expect(catalog).toMatch(/## Incident runbooks/);
    expect(catalog).toMatch(/## Export \+ deletion SLAs/);
    expect(catalog).toMatch(/## Dependency upgrade policy/);
    expect(catalog).toMatch(/## RLS matrix/);
    expect(catalog).toMatch(/## Secrets policy/);
    expect(catalog).toMatch(/## MCP Mode A/);
    expect(catalog).toMatch(/ChatGPT Mode A tool count: `7`/);
    expect(catalog).toMatch(
      /Allowed tools: `memory.search`, `memory.get`, `context.project`,[\s\S]*`memory.set_status`/,
    );
    expect(catalog).not.toMatch(/"token"\s*:/i);
    expect(catalog).not.toMatch(/"payload"\s*:/i);
    expect(catalog).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/i);

    expect(docsReadme).toContain(
      '[engineering/M14_DOC_CATALOG.md](engineering/M14_DOC_CATALOG.md)',
    );
  });
});

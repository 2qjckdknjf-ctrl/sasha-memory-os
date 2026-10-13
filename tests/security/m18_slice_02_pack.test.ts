import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M18_PROJECT_CONTEXT_PACK } from '@memory-os/schemas';

function repoFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    'utf8',
  );
}

describe('M18.2 project context pack', () => {
  it('freezes the bounded explicit-project contract', () => {
    expect(OFFICIAL_M18_PROJECT_CONTEXT_PACK).toMatchObject({
      version: 'm18-s02-v1',
      tokenBudget: { default: 1800, min: 768, max: 8000 },
      invariants: {
        explicitProjectRequired: true,
        crossProjectRecordFailsClosed: true,
        noDefaultProjectFallback: true,
        citationsRequiredForClaims: true,
        sourceFreshnessRequired: true,
        modeAToolCount: 7,
      },
    });
  });

  it('ships API, MCP, Edge and Cursor integration without an eighth tool', () => {
    const api = repoFile('apps/api/src/app.ts');
    const mcp = repoFile('apps/mcp-gateway/src/tools.ts');
    const edge = repoFile('supabase/functions/memory-mcp/index.ts');
    const cursor = repoFile('scripts/cursor-mcp-session.mjs');
    const aclMigration = repoFile(
      'supabase/migrations/20261013164246_m18_project_context_source_acl.sql',
    );
    const ephemeral = repoFile('scripts/ci-ephemeral-shared-memory-smoke.sh');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(api).toContain("'/v1/projects/:id/context-pack'");
    expect(mcp).toContain('buildProjectContextPack');
    expect(edge).toContain('buildEdgeProjectContextPack');
    expect(cursor).toContain("result.packVersion === 'm18-s02-v1'");
    expect(cursor).toContain('canonicalDecisions: result.canonicalDecisions ?? []');
    expect(cursor).toContain('provenance: result.provenance ?? null');
    expect(aclMigration).toContain("'project_state',");
    expect(aclMigration).toContain("'handoff',");
    expect(aclMigration.match(/app\.has_acl\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(ephemeral).toContain('m18_slice_02_context_acl_cases.sql');
    expect(current).toMatchObject({
      completedThrough: 'M18.1',
      nextSlice: 'M18.2_PROJECT_CONTEXT_PACK',
      officialPacks: { m18ProjectContext: 'm18-s02-v1' },
      chatgptModeA: { toolCount: 7 },
    });
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const repoFile = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

describe('M20.1 security release gate pack', () => {
  it('freezes all canonical security gates and threat surfaces', () => {
    expect(OFFICIAL_M20_SECURITY_RELEASE_GATE_PACK).toMatchObject({
      version: 'm20-s01-v1',
      invariants: {
        allPublicMemoryTablesUseRls: true,
        allPrivilegedRpcsAreSecurityDefiner: true,
        allSecurityDefinersPinSearchPath: true,
        clientRolesCannotExecutePrivilegedRpcs: true,
        clientRolesCannotUsePrivateSchema: true,
        opaqueSecretsStayServerSide: true,
        revokeStopsFutureSync: true,
        browserBundlesContainNoServerSecrets: true,
        noOpenP0OrP1: true,
      },
    });
  });

  it('wires exhaustive SQL, trusted-main Auth hardening, and human evidence', () => {
    const sql = repoFile('tests/security/m20_security_role_boundary_cases.sql');
    const workflow = repoFile('.github/workflows/m20-auth-hardening.yml');
    const docs = repoFile('docs/engineering/M20_SLICE_01_SECURITY_RELEASE_GATE.md');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(sql).toContain("c.relkind IN ('r', 'p')");
    expect(sql).toContain("left(p.proname, 4) = 'api_'");
    expect(sql).toContain("config.value LIKE 'search_path=%'");
    expect(sql).toContain("has_function_privilege('service_role'");
    expect(sql).toContain("has_table_privilege('anon', 'public.connector_vault_blobs'");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("'.password_hibp_enabled == true'");
    expect(workflow).not.toContain('echo "$SUPABASE_ACCESS_TOKEN"');
    expect(docs).toContain('zero open P0/P1');
    expect(docs).toContain('source content treated as data');
    expect(docs).toContain('M20.1 stays open');
    expect(current.officialPacks.m20SecurityReleaseGate).toBe('m20-s01-v1');
  });
});

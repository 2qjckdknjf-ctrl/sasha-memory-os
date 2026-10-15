import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M20_RELIABILITY_DR_GATE_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const repoFile = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

describe('M20.2 reliability and DR release gate', () => {
  it('wires a disposable current-schema restore and the recovery SQL drill into mandatory CI', () => {
    const ci = repoFile('scripts/ci-ephemeral-shared-memory-smoke.sh');
    const restore = repoFile('scripts/m20-current-schema-restore-drill.sh');
    const sql = repoFile('tests/security/m20_reliability_dr_cases.sql');
    const oauthRecovery = repoFile(
      'supabase/migrations/20261015210000_m20_oauth_reauthentication_boundary.sql',
    );
    const docs = repoFile('docs/engineering/M20_SLICE_02_RELIABILITY_DR.md');
    const current = JSON.parse(repoFile('docs/engineering/CURRENT_STATE.json'));

    expect(OFFICIAL_M20_RELIABILITY_DR_GATE_PACK.version).toBe('m20-s02-v1');
    expect(ci).toContain('m20-current-schema-restore-drill.sh');
    expect(ci).toContain('m20_reliability_dr_cases.sql');
    expect(restore).toContain('--schema=public');
    expect(restore).toContain('--schema=app');
    expect(restore).toContain('m20_security_role_boundary_cases.sql');
    expect(restore).toContain('payload_logged=false');
    expect(sql).toContain('api_dead_letter_stale_jobs');
    expect(sql).toContain('api_replay_connector_sync');
    expect(sql).toContain('api_retry_connector_sync');
    expect(sql).toContain('api_oauth_start');
    expect(sql).toContain('api_oauth_complete_stub');
    expect(sql).toContain("'exchanged'");
    expect(sql).toContain('before bounded backoff elapsed');
    expect(sql).toContain('before dead-lettering');
    expect(sql).toContain('reauth_required');
    expect(sql).toContain('ROLLBACK;');
    expect(oauthRecovery).toContain(
      "v_mode NOT IN ('stub', 'credentials_ready', 'exchanged')",
    );
    expect(docs).toContain('15 Oct 2026 06:59:40 (+0000)');
    expect(docs).toContain('PITR is not enabled');
    expect(docs).toContain('0 buckets / 0 objects');
    expect(docs).toContain('production restore is not authorized');
    expect(current.officialPacks.m20ReliabilityDr).toBe('m20-s02-v1');
    expect(current.tests.m20ReliabilityDrSql).toBe(
      'tests/security/m20_reliability_dr_cases.sql',
    );
  });
});

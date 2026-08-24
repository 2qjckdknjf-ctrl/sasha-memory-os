import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const preflightPath = resolve(root, 'scripts/ci-live-migration-preflight.sh');

describe('P0 live migration preflight pack', () => {
  const script = readFileSync(preflightPath, 'utf8');

  it('uses read-only memory.search probe and never store_decision', () => {
    expect(script).toContain('"memory.search"');
    expect(script).toContain('read-only');
    expect(script).not.toContain('memory.store_decision');
  });

  it('emits BLOCKED_REMOTE_MIGRATION without failing closed on missing project', () => {
    expect(script).toContain('live_migration_preflight=BLOCKED_REMOTE_MIGRATION');
    expect(script).toContain('project not found');
  });

  it('fails closed on empty curl response instead of emitting ready', () => {
    expect(script).toContain('empty_or_missing_response');
    expect(script).toMatch(/\[\[ -z "\$\{response/);
    const readyIndex = script.indexOf('live_migration_preflight=ready');
    const emptyCheckIndex = script.indexOf('empty_or_missing_response');
    expect(emptyCheckIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(emptyCheckIndex);
  });
});

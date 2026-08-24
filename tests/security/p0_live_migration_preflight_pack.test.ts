import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const preflightPath = resolve(root, 'scripts/ci-live-migration-preflight.sh');
const parserPath = resolve(root, 'scripts/ci-live-migration-preflight-parse.mjs');
const workflowPath = resolve(root, '.github/workflows/ci.yml');

describe('P0 live migration preflight pack', () => {
  const script = readFileSync(preflightPath, 'utf8');
  const parser = readFileSync(parserPath, 'utf8');
  const workflow = readFileSync(workflowPath, 'utf8');

  it('uses read-only memory.search probe and never store_decision', () => {
    expect(script).toContain('"memory.search"');
    expect(script).toContain('read-only');
    expect(script).not.toContain('memory.store_decision');
  });

  it('emits allowlisted BLOCKED_REMOTE_MIGRATION without echoing raw response', () => {
    expect(parser).toContain('BLOCKED_REMOTE_MIGRATION');
    expect(script).not.toMatch(/echo\s+.*\$response/);
    expect(script).not.toContain('grep \'\"error\"\'');
  });

  it('stores curl output in a restricted temp file and parses structurally', () => {
    expect(script).toContain('mktemp');
    expect(script).toContain('chmod 600');
    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain('ci-live-migration-preflight-parse.mjs');
    expect(parser).toContain('hasNonEmptyTopLevelJsonRpcError');
  });

  it('workflow gates live smoke on sanitized status tokens without tee', () => {
    const liveBlock = workflow.slice(
      workflow.indexOf('live-edge-smoke:'),
      workflow.indexOf('ci-summary:'),
    );
    expect(liveBlock).toContain('live_migration_preflight=BLOCKED_REMOTE_MIGRATION');
    expect(liveBlock).toContain('live_migration_preflight=READY_FOR_LIVE_SMOKE');
    expect(liveBlock).not.toMatch(/preflight\.sh[^\n]*\|\s*tee/);
  });
});

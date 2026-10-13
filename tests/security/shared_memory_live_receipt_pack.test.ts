import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('shared-memory live receipt gate', () => {
  const workflow = readFileSync(
    resolve(root, '.github/workflows/shared-memory-e2e.yml'),
    'utf8',
  );
  const verifier = readFileSync(
    resolve(root, 'scripts/acceptance-shared-memory-e2e.sh'),
    'utf8',
  );

  it('runs the fixture suite through the workspace package manager', () => {
    expect(workflow).toContain(
      'pnpm exec vitest run tests/security/p0_project_identity_pack.test.ts',
    );
    expect(workflow).not.toMatch(/run:\s+vitest run/);
  });

  it('requires receipts from real ChatGPT and Cursor sessions', () => {
    expect(workflow).toContain('chatgpt_memory_id:');
    expect(workflow).toContain('cursor_memory_id:');
    expect(workflow).not.toContain('REQUIRES_REAL_CHATGPT_SESSION');
    expect(verifier).toContain('read-only-live-session-receipts');
    expect(verifier).toContain('33333333-3333-4333-8333-333333333302');
    expect(verifier).toContain('33333333-3333-4333-8333-333333333303');
  });

  it('does not create acceptance evidence with the API secret', () => {
    expect(verifier).toContain('name: "memory.get"');
    expect(verifier).not.toContain('memory.store_decision');
    expect(verifier).not.toContain('/v1/capture/text');
  });
});

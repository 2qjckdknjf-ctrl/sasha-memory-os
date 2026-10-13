import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK } from '@memory-os/schemas';

function repoFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    'utf8',
  );
}

describe('M18.1 Cursor bootstrap enforcement pack', () => {
  it('installs an always-on project rule and session hook', () => {
    const rule = repoFile('.cursor/rules/memory-os-lifecycle.mdc');
    const hooks = JSON.parse(repoFile('.cursor/hooks.json'));

    expect(rule).toContain('alwaysApply: true');
    expect(rule).toContain('bootstrap --project-id 44444444-4444-4444-8444-444444444402');
    expect(rule).toContain('readAfterWrite.verified=true');
    expect(hooks).toEqual({
      version: 1,
      hooks: {
        sessionStart: [
          {
            command: 'node .cursor/hooks/memory-os-session-start.mjs',
            timeout: 10,
            failClosed: false,
          },
        ],
      },
    });
  });

  it('injects project-scoped A-G context at Cursor session start', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const raw = execFileSync(
      process.execPath,
      ['.cursor/hooks/memory-os-session-start.mjs'],
      {
        cwd: root,
        encoding: 'utf8',
        input: JSON.stringify({ session_id: 'm18-test-session' }),
        env: { ...process.env, CURSOR_PROJECT_DIR: root },
      },
    );
    const result = JSON.parse(raw);

    expect(result.env).toMatchObject({
      MEMORY_OS_CURSOR_BOOTSTRAP_VERSION: 'm18-s01-v1',
      MEMORY_OS_CURSOR_PROJECT_ID: '44444444-4444-4444-8444-444444444402',
      MEMORY_OS_CURSOR_SESSION_ID: 'm18-test-session',
    });
    expect(result.additional_context).toContain('Then follow A–G');
    expect(result.additional_context).toContain('readAfterWrite.verified=true');
  });

  it('binds bootstrap, merge writeback and read-after-write in one workflow', () => {
    const workflow = repoFile('scripts/cursor-mcp-session.mjs');

    expect(OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK.version).toBe('m18-s01-v1');
    expect(workflow).toContain("if (command === 'bootstrap')");
    expect(workflow).toContain("'memory.search'");
    expect(workflow).toContain("'context.project'");
    expect(workflow).toContain("'memory.store_decision'");
    expect(workflow).toContain("'memory.get'");
    expect(workflow).toContain("'edge-http'");
    expect(workflow).toContain('Memory read-after-write verification failed');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('node-workers workflow', () => {
  const workflow = readFileSync(
    resolve(root, '.github/workflows/node-workers.yml'),
    'utf8',
  );

  it('fails the workflow when ROMA project health fails', () => {
    expect(workflow).toContain('- name: ROMA scheduled project health once');
    expect(workflow).not.toContain('continue-on-error: true');

    const romaIndex = workflow.indexOf('- name: ROMA scheduled project health once');
    const syncIndex = workflow.indexOf('- name: Connector sync once');

    expect(romaIndex).toBeGreaterThanOrEqual(0);
    expect(syncIndex).toBeGreaterThan(romaIndex);
  });

  it('resolves and masks one server-only key before production workers run', () => {
    const resolverIndex = workflow.indexOf(
      '- name: Resolve server-only Supabase key',
    );
    const consolidationIndex = workflow.indexOf('- name: Consolidation once');
    const directSecretReferences = workflow.match(
      /secrets\.MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY/g,
    );

    expect(resolverIndex).toBeGreaterThanOrEqual(0);
    expect(consolidationIndex).toBeGreaterThan(resolverIndex);
    expect(workflow).toContain('/api-keys?reveal=true');
    expect(workflow).toContain('startswith("sb_secret_")');
    expect(workflow).toContain('echo "::add-mask::$server_key"');
    expect(workflow).toContain(
      "printf 'MEMORY_OS_SUPABASE_SERVICE_ROLE_KEY=%s\\n' \"$server_key\" >> \"$GITHUB_ENV\"",
    );
    expect(directSecretReferences).toHaveLength(1);
  });
});

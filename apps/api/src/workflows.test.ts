import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('node-workers workflow', () => {
  it('fails the workflow when ROMA project health fails', () => {
    const workflow = readFileSync(
      resolve(root, '.github/workflows/node-workers.yml'),
      'utf8',
    );

    expect(workflow).toContain('- name: ROMA scheduled project health once');
    expect(workflow).not.toContain('continue-on-error: true');

    const romaIndex = workflow.indexOf('- name: ROMA scheduled project health once');
    const syncIndex = workflow.indexOf('- name: Connector sync once');

    expect(romaIndex).toBeGreaterThanOrEqual(0);
    expect(syncIndex).toBeGreaterThan(romaIndex);
  });
});

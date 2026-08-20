import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('node-workers workflow', () => {
  it('isolates the ROMA scheduled worker step from connector sync', () => {
    const workflow = readFileSync(
      resolve(root, '.github/workflows/node-workers.yml'),
      'utf8',
    );

    expect(workflow).toContain('- name: ROMA scheduled project health once');
    expect(workflow).toContain('continue-on-error: true');

    const romaIndex = workflow.indexOf('- name: ROMA scheduled project health once');
    const continueIndex = workflow.indexOf('continue-on-error: true', romaIndex);
    const syncIndex = workflow.indexOf('- name: Connector sync once');

    expect(romaIndex).toBeGreaterThanOrEqual(0);
    expect(continueIndex).toBeGreaterThan(romaIndex);
    expect(syncIndex).toBeGreaterThan(romaIndex);
  });
});

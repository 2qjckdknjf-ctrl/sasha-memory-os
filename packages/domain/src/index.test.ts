import { describe, expect, it } from 'vitest';
import { assertNonEmptyWorkspaceId, packageName } from './index.js';

describe('domain', () => {
  it('exports package name', () => {
    expect(packageName).toBe('domain');
  });

  it('accepts non-empty workspace ids', () => {
    expect(assertNonEmptyWorkspaceId('ws_demo')).toBe('ws_demo');
  });

  it('rejects empty workspace ids', () => {
    expect(() => assertNonEmptyWorkspaceId('  ')).toThrow(/workspace_id/);
  });
});

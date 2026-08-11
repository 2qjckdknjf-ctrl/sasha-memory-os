import { describe, expect, it } from 'vitest';
import {
  assertNonEmptyWorkspaceId,
  filterCurrentMemories,
  nextProjectStateVersion,
  packageName,
  sensitivityRank,
  type MemoryRecord,
} from './index.js';

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

  it('ranks sensitivity', () => {
    expect(sensitivityRank('public')).toBeLessThan(sensitivityRank('restricted'));
  });

  it('filters current truth', () => {
    const records = [
      { status: 'verified' },
      { status: 'superseded' },
      { status: 'active' },
    ] as MemoryRecord[];
    expect(filterCurrentMemories(records).map((r) => r.status)).toEqual([
      'verified',
      'active',
    ]);
  });

  it('enforces optimistic project state versioning', () => {
    expect(nextProjectStateVersion(null, 0)).toBe(1);
    expect(() => nextProjectStateVersion(null, 1)).toThrow(/conflict/);
  });
});

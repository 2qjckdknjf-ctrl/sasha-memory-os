import { describe, expect, it } from 'vitest';
import {
  AISTROYKA_PROJECT_ID,
  CANONICAL_PROJECT_ID,
  HIAIR_PROJECT_ID,
  OFFICIAL_P0_PROJECT_IDENTITY_PACK,
  OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION,
  PROJECT_ID_BY_SLUG,
  SASHA_MEMORY_OS_PROJECT_ID,
} from './projectIdentity.js';

describe('P0 project identity pack', () => {
  it('assigns distinct UUIDs per project', () => {
    expect(OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION).toBe('p0-project-identity-v1');
    const ids = [
      AISTROYKA_PROJECT_ID,
      SASHA_MEMORY_OS_PROJECT_ID,
      HIAIR_PROJECT_ID,
    ];
    expect(new Set(ids).size).toBe(3);
    expect(CANONICAL_PROJECT_ID).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(CANONICAL_PROJECT_ID).not.toBe(AISTROYKA_PROJECT_ID);
  });

  it('resolves slugs without cross-project collision', () => {
    expect(PROJECT_ID_BY_SLUG.aistroyka).toBe(AISTROYKA_PROJECT_ID);
    expect(PROJECT_ID_BY_SLUG['sasha-memory-os']).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(PROJECT_ID_BY_SLUG.mamoruos).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(PROJECT_ID_BY_SLUG.hiair).toBe(HIAIR_PROJECT_ID);
  });

  it('enforces fail-closed routing invariants', () => {
    expect(OFFICIAL_P0_PROJECT_IDENTITY_PACK.invariants).toMatchObject({
      neverUseDefaultProjectFallback: true,
      neverUseAistroykaFallback: true,
      writesRequireExplicitProjectId: true,
      oneUuidPerProject: true,
    });
  });
});

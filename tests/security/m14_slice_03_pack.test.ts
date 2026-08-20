import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_SECURITY_REVIEW_PACK,
  OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 03 security review pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION).toBe('m14-s03-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.version).toBe('m14-s03-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.roadmapSections).toEqual(['20.17']);
    expect(OFFICIAL_M14_SECURITY_REVIEW_PACK.invariants).toMatchObject({
      defensiveOnly: true,
      modeAToolCount: 7,
      requireExplicitProjectIdOnWrites: true,
      rejectUnauthenticatedMcp: true,
      allowOwnerTokenBypass: false,
      allowAistroykaFallback: false,
      allowVerifiedWrites: false,
      logMemoryBodies: false,
      logTokens: false,
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_SECURITY_REVIEW_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official checklist coverage', () => {
    expect(
      OFFICIAL_M14_SECURITY_REVIEW_PACK.checklist.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        'rls-matrix',
        'acl-default-deny',
        'mcp-unauthenticated-reject',
        'mode-a-surface',
        'no-owner-token-bypass',
        'no-aistroyka-fallback',
        'no-verified-write-or-payload-leak',
      ]),
    );
    expect(
      OFFICIAL_M14_SECURITY_REVIEW_PACK.checklist.find(
        (item) => item.id === 'rls-matrix',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        'tests/security/rls_matrix.test.ts',
        'tests/security/rls_policy_cases.sql',
        'docs/engineering/RLS_MATRIX.md',
        'apps/api/src/supabase.rls.test.ts',
      ]),
    );
  });

  it('documents slice scope and defensive-only exclusions', () => {
    const doc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_03.md'),
      'utf8',
    );
    expect(doc).toContain('Official pack version: `m14-s03-v1`');
    expect(doc).toMatch(/## In scope/);
    expect(doc).toMatch(/## Out of scope/);
    expect(doc).toMatch(/reject unauthenticated MCP HTTP/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/explicit `project_id`/i);
    expect(doc).toMatch(/never default writes to AISTROYKA/i);
    expect(doc).toMatch(/No SQL migration is required/i);
    expect(doc).toMatch(/No production SQL apply/i);
    expect(doc).toMatch(/exploit PoCs/i);
  });
});

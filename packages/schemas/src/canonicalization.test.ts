import { describe, expect, it } from 'vitest';
import {
  FACT_CLASS_AUTHORITY,
  OFFICIAL_M15_CANONICALIZATION_PACK,
  OFFICIAL_M15_CANONICALIZATION_PACK_VERSION,
  buildSourceDedupeKey,
  decideCanonicalDedupe,
  measureCanonicalDuplicateRate,
  type CanonicalCandidate,
} from './canonicalization.js';

const project = '44444444-4444-4444-8444-444444444401';

function candidate(
  partial: Partial<CanonicalCandidate> & Pick<CanonicalCandidate, 'id'>,
): CanonicalCandidate {
  return {
    factClass: 'inferred_summary',
    authoritySource: 'agent_inferred',
    projectId: project,
    contentFingerprint: 'fp-1',
    ...partial,
  };
}

describe('M15.4 canonicalization pack', () => {
  it('publishes authority matrix and duplicate-rate acceptance', () => {
    expect(OFFICIAL_M15_CANONICALIZATION_PACK_VERSION).toBe('m15-s04-v1');
    expect(FACT_CLASS_AUTHORITY.repository_state.preferred).toContain('live_github');
    expect(FACT_CLASS_AUTHORITY.user_decision.preferred).toContain(
      'user_approved_decision',
    );
    expect(OFFICIAL_M15_CANONICALIZATION_PACK.acceptance.canonicalDuplicateRateMax).toBe(
      0.01,
    );
    expect(OFFICIAL_M15_CANONICALIZATION_PACK.invariants).toMatchObject({
      preserveSupersededByChain: true,
      preserveProvenanceToSourceEvents: true,
      modeAToolCount: 7,
    });
  });

  it('source-dedupes identical external identity and supersedes same fingerprint by authority', () => {
    expect(
      buildSourceDedupeKey({
        provider: 'GitHub',
        externalId: 'issue:1',
        externalVersion: '3',
      }),
    ).toBe('github::issue:1@3');

    const source = decideCanonicalDedupe(
      candidate({
        id: 'a',
        factClass: 'repository_state',
        authoritySource: 'connector_snapshot',
        provider: 'github',
        externalId: 'issue:1',
        externalVersion: '3',
      }),
      candidate({
        id: 'b',
        factClass: 'repository_state',
        authoritySource: 'live_github',
        provider: 'github',
        externalId: 'issue:1',
        externalVersion: '3',
      }),
    );
    expect(source).toMatchObject({
      action: 'source_dedupe',
      keeperId: 'b',
      duplicateId: 'a',
    });

    const semantic = decideCanonicalDedupe(
      candidate({
        id: 'sum-1',
        factClass: 'inferred_summary',
        authoritySource: 'agent_inferred',
        contentFingerprint: 'same',
      }),
      candidate({
        id: 'dec-1',
        factClass: 'inferred_summary',
        authoritySource: 'user_approved_decision',
        contentFingerprint: 'same',
      }),
    );
    expect(semantic).toMatchObject({
      action: 'supersede',
      keeperId: 'dec-1',
      duplicateId: 'sum-1',
    });
  });

  it('keeps cross-project candidates separate and measures duplicate rate', () => {
    const cross = decideCanonicalDedupe(
      candidate({ id: 'p1', projectId: project, contentFingerprint: 'x' }),
      candidate({
        id: 'p2',
        projectId: '55555555-5555-4555-8555-555555555501',
        contentFingerprint: 'x',
      }),
    );
    expect(cross.action).toBe('keep_both');
    expect(measureCanonicalDuplicateRate({
      totalCanonicalMemories: 200,
      duplicatePairsMerged: 1,
    })).toBeLessThanOrEqual(0.01);
  });
});

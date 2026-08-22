import { describe, expect, it } from 'vitest';
import {
  ENTITY_RESOLUTION_CONFIDENCE_THRESHOLD,
  OFFICIAL_M17_ENTITY_RESOLUTION_PACK,
  OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION,
  resolveEntityCandidate,
} from './entityResolution.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const repoId = 'entity:repository:github:2qjckdknjf-ctrl/sasha-memory-os';

describe('M17.2 entity resolution pack', () => {
  it('publishes cross-source resolution without live E2E PASS', () => {
    expect(OFFICIAL_M17_ENTITY_RESOLUTION_PACK_VERSION).toBe('m17-s02-v1');
    expect(OFFICIAL_M17_ENTITY_RESOLUTION_PACK.acceptance.goldenPrecisionTarget).toBe(
      0.95,
    );
    expect(OFFICIAL_M17_ENTITY_RESOLUTION_PACK.invariants).toMatchObject({
      claimLiveEntityResolutionE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
    expect(ENTITY_RESOLUTION_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it('resolves aligned signals and fails closed on conflicts', () => {
    expect(
      resolveEntityCandidate({
        projectId,
        entityClass: 'repository',
        signals: [
          {
            kind: 'stable_source_ref',
            source: 'github',
            entityClass: 'repository',
            candidateStableId: repoId,
            weight: 1,
            evidence: 'repo webhook',
          },
          {
            kind: 'repository_full_name',
            source: 'github',
            entityClass: 'repository',
            candidateStableId: repoId,
            weight: 0.9,
            evidence: 'full name match',
          },
        ],
      }).outcome,
    ).toBe('resolved');

    expect(
      resolveEntityCandidate({
        projectId,
        entityClass: 'person',
        signals: [
          {
            kind: 'github_login',
            source: 'github',
            entityClass: 'person',
            candidateStableId: 'entity:person:github:alex-a',
            projectId: '11111111-1111-4111-8111-111111111111',
            weight: 0.9,
            evidence: 'login a',
          },
          {
            kind: 'email_address',
            source: 'gmail',
            entityClass: 'person',
            candidateStableId: 'entity:person:gmail:alex-b',
            projectId: '22222222-2222-4222-8222-222222222222',
            weight: 0.9,
            evidence: 'email b',
          },
        ],
      }).outcome,
    ).toBe('ambiguous');

    expect(
      resolveEntityCandidate({
        projectId,
        entityClass: 'repository',
        signals: [],
      }).reason,
    ).toBe('missing_signals');
  });
});

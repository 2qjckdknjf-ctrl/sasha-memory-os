import { describe, expect, it } from 'vitest';
import {
  chatgptWritebackEnvelopeSchema,
  OFFICIAL_M18_CHATGPT_WRITEBACK_PACK,
} from './chatgptWritebackPolicy.js';

describe('M18.4 ChatGPT automatic writeback policy', () => {
  it('publishes the seven-tool, approved-only writeback contract', () => {
    expect(OFFICIAL_M18_CHATGPT_WRITEBACK_PACK).toMatchObject({
      version: 'm18-s04-v1',
      invariants: {
        modeAToolCount: 7,
        existingStoreDecisionToolOnly: true,
        explicitProjectRequired: true,
        canonicalChatgptSubjectRequired: true,
        approvedOnly: true,
        readBeforeWriteRequired: true,
        deterministicDedupeRequired: true,
        provenanceRequired: true,
        conflictRequiresReview: true,
        readAfterWriteRequired: true,
        manualStoreDecisionCompatible: true,
      },
    });
  });

  it('requires bounded approval provenance and evidence', () => {
    expect(
      chatgptWritebackEnvelopeSchema.parse({
        kind: 'approved_decision',
        approval: {
          source: 'explicit_user',
          reference: 'conversation:turn-42',
        },
        evidence_refs: ['memory:source-1'],
      }),
    ).toMatchObject({ kind: 'approved_decision' });

    expect(() =>
      chatgptWritebackEnvelopeSchema.parse({
        kind: 'completed_milestone',
        approval: {
          source: 'verified_workflow',
          reference: 'ci:run-42',
        },
        evidence_refs: [],
      }),
    ).toThrow();
  });
});

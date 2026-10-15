import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M18_ROMA_INTEGRATION_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M18.3 ROMA integration pack', () => {
  it('publishes the review-gated shared-memory contract', () => {
    expect(OFFICIAL_M18_ROMA_INTEGRATION_PACK).toMatchObject({
      version: 'm18-s03-v1',
      consumesProjectContextPack: 'm18-s02-v1',
      findingPolicy: {
        canonicalStatus: 'candidate',
        requiresReview: true,
        defaultConfidence: 0.6,
      },
      invariants: {
        explicitProjectRequired: true,
        auditedWritesRequired: true,
        deterministicDedupeRequired: true,
        releaseEvidenceRequiredWhenAvailable: true,
        lowConfidenceCannotAutoVerify: true,
        modeAToolCount: 7,
      },
    });
  });

  it('wires context, release evidence, dedupe, and read-after-write enforcement', () => {
    const worker = readFileSync(
      resolve(root, 'workers/roma-project-health/src/index.ts'),
      'utf8',
    );
    const docs = readFileSync(
      resolve(root, 'docs/engineering/M18_SLICE_03.md'),
      'utf8',
    );
    const current = JSON.parse(
      readFileSync(resolve(root, 'docs/engineering/CURRENT_STATE.json'), 'utf8'),
    );
    const migration = readFileSync(
      resolve(
        root,
        'supabase/migrations/20261015164000_m18_roma_release_evidence.sql',
      ),
      'utf8',
    );
    const ephemeral = readFileSync(
      resolve(root, 'scripts/ci-ephemeral-shared-memory-smoke.sh'),
      'utf8',
    );

    expect(worker).toContain('buildProjectContextPack');
    expect(worker).toContain('releaseEvidenceRefs');
    expect(worker).toContain('findingRevision');
    expect(worker).toContain('verifyRomaCandidateWrite');
    expect(worker).toContain("canonical_status: candidate.canonicalStatus");
    expect(worker).toContain('auto_verify_allowed: false');
    expect(migration).toContain("WHEN 'release' THEN");
    expect(migration).toContain("'citationIds'");
    expect(ephemeral).toContain(
      'm18_slice_03_roma_release_evidence_cases.sql',
    );
    expect(docs).toContain('ChatGPT Mode A remains exactly seven tools');
    expect(current).toMatchObject({
      completedThrough: 'M18.3',
      nextSlice: 'M18.4_CHATGPT_AUTOMATIC_WRITEBACK_POLICY',
      officialPacks: { m18RomaIntegration: 'm18-s03-v1' },
      chatgptModeA: { toolCount: 7 },
      m18RomaIntegrationLiveReceipt: {
        packVersion: 'm18-s03-v1',
        memoryId: 'ea0746e7-6557-4c66-b017-005e3c06f157',
        workerRun: 38764649250,
        jobId: 'a5f6a9af-5537-40be-afb4-a9f542c88447',
        findingCount: 3,
        budgetEventCount: 3,
        candidateOnly: true,
        confidence: 0.6,
        requiresReview: true,
        workspaceWideRomaAclCount: 0,
        handoffWriteGranted: false,
        readAfterWrite: true,
      },
    });
  });
});

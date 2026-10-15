import { z } from 'zod';

export const OFFICIAL_M18_CHATGPT_WRITEBACK_PACK_VERSION = 'm18-s04-v1' as const;

export const chatgptWritebackKindSchema = z.enum([
  'approved_decision',
  'completed_milestone',
]);

export const chatgptWritebackApprovalSchema = z.object({
  source: z.enum(['explicit_user', 'verified_workflow']),
  reference: z.string().trim().min(1).max(500),
});

export const chatgptWritebackEnvelopeSchema = z.object({
  kind: chatgptWritebackKindSchema,
  approval: chatgptWritebackApprovalSchema,
  evidence_refs: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
});

export type ChatgptWritebackEnvelope = z.infer<
  typeof chatgptWritebackEnvelopeSchema
>;

export const OFFICIAL_M18_CHATGPT_WRITEBACK_PACK = {
  version: OFFICIAL_M18_CHATGPT_WRITEBACK_PACK_VERSION,
  roadmapSections: ['18', 'chatgpt-automatic-writeback', 'shared-agent-lifecycle'],
  supportedKinds: ['approved_decision', 'completed_milestone'],
  approvalSources: ['explicit_user', 'verified_workflow'],
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
} as const;

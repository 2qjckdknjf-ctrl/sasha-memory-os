import { z } from 'zod';
import {
  ingestionEnvelopeSchema,
  sensitivitySchema,
  storageModeSchema,
  type IngestionEnvelope,
} from './ingestion.js';

/** Official M15.1 pack identity. */
export const OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION = 'm15-s01-v1' as const;

export const sourceEventChangeStateSchema = z.enum([
  'upsert',
  'delete',
  'revoke',
]);

export const sourceEventIngestionAdapterSchema = z.enum([
  'webhook',
  'polling',
  'agent',
  'manual',
]);

/**
 * Canonical source-event envelope (schema 1.1).
 * Additive over ingestion envelope 1.0: change_state + adapter + stronger
 * external identity fields while remaining backward-compatible with 1.0 bodies.
 */
export const sourceEventEnvelopeV1Schema = ingestionEnvelopeSchema
  .omit({ schema_version: true })
  .extend({
    schema_version: z.enum(['1.0', '1.1']).default('1.1'),
    change_state: sourceEventChangeStateSchema.default('upsert'),
    ingestion_adapter: sourceEventIngestionAdapterSchema.default('manual'),
    source: z.object({
      provider: z.string().min(1),
      account_id: z.string().uuid().optional(),
      external_id: z.string().min(1).optional(),
      external_version: z.string().optional(),
    }),
  });

export type SourceEventEnvelopeV1 = z.infer<typeof sourceEventEnvelopeV1Schema>;
export type SourceEventChangeState = z.infer<typeof sourceEventChangeStateSchema>;
export type SourceEventIngestionAdapter = z.infer<
  typeof sourceEventIngestionAdapterSchema
>;

export const OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK = {
  version: OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION,
  roadmapSections: ['15.1', 'universal-ingestion'],
  envelopeSchemaVersions: ['1.0', '1.1'] as const,
  adapters: ['webhook', 'polling', 'agent', 'manual'] as const,
  changeStates: ['upsert', 'delete', 'revoke'] as const,
  invariants: {
    appendOnlySourceEvents: true,
    duplicateDeliverySingleLogicalEvent: true,
    replaySafeIdempotency: true,
    writesRequireExplicitProjectId: true,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    modeAToolCount: 7,
    allowVerifiedWritesFromIngestAlone: false,
  },
} as const;

export function buildSourceEventIdempotencyKey(input: {
  adapter: SourceEventIngestionAdapter;
  provider: string;
  accountId?: string | null;
  externalId?: string | null;
  externalVersion?: string | null;
  deliveryId?: string | null;
  agentKey?: string | null;
}): string {
  const account = input.accountId?.trim() || 'no-account';
  if (input.adapter === 'webhook') {
    const delivery = input.deliveryId?.trim();
    if (!delivery) {
      throw new Error('webhook idempotency requires deliveryId');
    }
    return `webhook/${input.provider}/${account}/${delivery}`;
  }
  if (input.adapter === 'polling') {
    const externalId = input.externalId?.trim();
    if (!externalId) {
      throw new Error('polling idempotency requires externalId');
    }
    const version = input.externalVersion?.trim() || 'v0';
    return `polling/${input.provider}/${account}/${externalId}@${version}`;
  }
  if (input.adapter === 'agent') {
    const key = input.agentKey?.trim();
    if (!key) {
      throw new Error('agent idempotency requires agentKey');
    }
    return `agent/${input.provider}/${account}/${key}`;
  }
  const key = input.agentKey?.trim() || input.externalId?.trim();
  if (!key) {
    throw new Error('manual idempotency requires agentKey or externalId');
  }
  return `manual/${input.provider}/${account}/${key}`;
}

export function parseSourceEventEnvelope(
  raw: unknown,
): SourceEventEnvelopeV1 {
  return sourceEventEnvelopeV1Schema.parse(raw);
}

/** Lift a legacy 1.0 ingestion envelope into the canonical 1.1 contract. */
export function upgradeIngestionEnvelope(
  envelope: IngestionEnvelope,
  extras?: {
    change_state?: SourceEventChangeState;
    ingestion_adapter?: SourceEventIngestionAdapter;
  },
): SourceEventEnvelopeV1 {
  return sourceEventEnvelopeV1Schema.parse({
    ...envelope,
    schema_version: '1.1',
    change_state: extras?.change_state ?? 'upsert',
    ingestion_adapter: extras?.ingestion_adapter ?? 'manual',
  });
}

export function sourceEventContentChecksum(
  envelope: SourceEventEnvelopeV1,
): string | null {
  return envelope.content?.checksum ?? null;
}

export {
  sensitivitySchema,
  storageModeSchema,
};

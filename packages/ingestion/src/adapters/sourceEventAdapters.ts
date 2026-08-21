import { createHash } from 'node:crypto';
import {
  buildSourceEventIdempotencyKey,
  parseSourceEventEnvelope,
  type SourceEventEnvelopeV1,
  type SourceEventIngestionAdapter,
} from '@memory-os/schemas';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function requireProjectId(projectId: string | undefined, surface: string): string {
  const value = projectId?.trim();
  if (!value) {
    throw new Error(`project_id is required for ${surface} source-event ingest`);
  }
  return value;
}

export type WebhookAdapterInput = {
  workspaceId: string;
  projectId: string;
  provider: string;
  accountId?: string;
  deliveryId: string;
  eventType: string;
  observedAt: string;
  externalId?: string;
  externalVersion?: string;
  payload: Record<string, unknown>;
  text?: string;
  sensitivity?: SourceEventEnvelopeV1['scope']['sensitivity'];
  changeState?: SourceEventEnvelopeV1['change_state'];
};

export type PollingAdapterInput = {
  workspaceId: string;
  projectId: string;
  provider: string;
  accountId?: string;
  externalId: string;
  externalVersion?: string;
  eventType: string;
  observedAt: string;
  title?: string;
  text?: string;
  mimeType?: string;
  checksum?: string;
  sensitivity?: SourceEventEnvelopeV1['scope']['sensitivity'];
  storageMode?: SourceEventEnvelopeV1['scope']['storage_mode'];
  provenance?: Record<string, unknown>;
  changeState?: SourceEventEnvelopeV1['change_state'];
};

export type AgentAdapterInput = {
  workspaceId: string;
  projectId: string;
  provider?: string;
  agentKey: string;
  eventType: string;
  observedAt?: string;
  title?: string;
  text?: string;
  sensitivity?: SourceEventEnvelopeV1['scope']['sensitivity'];
  provenance?: Record<string, unknown>;
  changeState?: SourceEventEnvelopeV1['change_state'];
};

export function normalizeWebhookSourceEvent(
  input: WebhookAdapterInput,
): SourceEventEnvelopeV1 {
  const projectId = requireProjectId(input.projectId, 'webhook');
  const text = input.text ?? JSON.stringify(input.payload);
  const checksum = sha256Hex(text);
  const idempotencyKey = buildSourceEventIdempotencyKey({
    adapter: 'webhook',
    provider: input.provider,
    accountId: input.accountId,
    deliveryId: input.deliveryId,
    externalId: input.externalId,
    externalVersion: input.externalVersion,
  });
  return parseSourceEventEnvelope({
    schema_version: '1.1',
    workspace_id: input.workspaceId,
    source: {
      provider: input.provider,
      account_id: input.accountId,
      external_id: input.externalId,
      external_version: input.externalVersion,
    },
    event_type: input.eventType,
    observed_at: input.observedAt,
    idempotency_key: idempotencyKey,
    change_state: input.changeState ?? 'upsert',
    ingestion_adapter: 'webhook' satisfies SourceEventIngestionAdapter,
    content: {
      mime_type: 'application/json',
      text,
      checksum,
    },
    scope: {
      project_id: projectId,
      sensitivity: input.sensitivity ?? 'internal',
      storage_mode: 'reference',
    },
    provenance: {
      adapter: 'webhook',
      delivery_id: input.deliveryId,
      payload_keys: Object.keys(input.payload).sort(),
    },
  });
}

export function normalizePollingSourceEvent(
  input: PollingAdapterInput,
): SourceEventEnvelopeV1 {
  const projectId = requireProjectId(input.projectId, 'polling');
  const text = input.text ?? input.title ?? input.externalId;
  const checksum = input.checksum ?? sha256Hex(text);
  const idempotencyKey = buildSourceEventIdempotencyKey({
    adapter: 'polling',
    provider: input.provider,
    accountId: input.accountId,
    externalId: input.externalId,
    externalVersion: input.externalVersion,
  });
  return parseSourceEventEnvelope({
    schema_version: '1.1',
    workspace_id: input.workspaceId,
    source: {
      provider: input.provider,
      account_id: input.accountId,
      external_id: input.externalId,
      external_version: input.externalVersion,
    },
    event_type: input.eventType,
    observed_at: input.observedAt,
    idempotency_key: idempotencyKey,
    change_state: input.changeState ?? 'upsert',
    ingestion_adapter: 'polling',
    content: {
      mime_type: input.mimeType ?? 'text/plain',
      text,
      checksum,
    },
    scope: {
      project_id: projectId,
      sensitivity: input.sensitivity ?? 'internal',
      storage_mode: input.storageMode ?? 'reference',
    },
    provenance: {
      adapter: 'polling',
      ...(input.provenance ?? {}),
    },
  });
}

export function normalizeAgentSourceEvent(
  input: AgentAdapterInput,
): SourceEventEnvelopeV1 {
  const projectId = requireProjectId(input.projectId, 'agent');
  const provider = input.provider?.trim() || 'agent';
  const text = input.text ?? input.title ?? input.agentKey;
  const checksum = sha256Hex(text);
  const idempotencyKey = buildSourceEventIdempotencyKey({
    adapter: 'agent',
    provider,
    agentKey: input.agentKey,
  });
  return parseSourceEventEnvelope({
    schema_version: '1.1',
    workspace_id: input.workspaceId,
    source: {
      provider,
      external_id: input.agentKey,
    },
    event_type: input.eventType,
    observed_at: input.observedAt ?? new Date().toISOString(),
    idempotency_key: idempotencyKey,
    change_state: input.changeState ?? 'upsert',
    ingestion_adapter: 'agent',
    content: {
      mime_type: 'text/plain',
      text,
      checksum,
    },
    scope: {
      project_id: projectId,
      sensitivity: input.sensitivity ?? 'internal',
      storage_mode: 'indexed',
    },
    provenance: {
      adapter: 'agent',
      ...(input.provenance ?? {}),
    },
  });
}

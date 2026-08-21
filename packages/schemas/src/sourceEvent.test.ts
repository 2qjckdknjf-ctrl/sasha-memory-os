import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK,
  OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION,
  buildSourceEventIdempotencyKey,
  parseSourceEventEnvelope,
  upgradeIngestionEnvelope,
} from './sourceEvent.js';

describe('M15.1 source event contract schema', () => {
  it('publishes the official pack version and invariants', () => {
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK_VERSION).toBe('m15-s01-v1');
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK.version).toBe('m15-s01-v1');
    expect(OFFICIAL_M15_SOURCE_EVENT_CONTRACT_PACK.invariants).toMatchObject({
      appendOnlySourceEvents: true,
      duplicateDeliverySingleLogicalEvent: true,
      replaySafeIdempotency: true,
      writesRequireExplicitProjectId: true,
      allowMemoryOsDefaultProjectIdFallback: false,
      modeAToolCount: 7,
    });
  });

  it('parses 1.1 envelopes and upgrades 1.0 bodies', () => {
    const upgraded = upgradeIngestionEnvelope({
      schema_version: '1.0',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      source: { provider: 'manual' },
      event_type: 'capture.text.created',
      observed_at: '2026-08-21T20:00:00.000Z',
      idempotency_key: 'manual-1',
      content: { text: 'hello', checksum: 'abc' },
      scope: {
        project_id: '44444444-4444-4444-8444-444444444401',
        sensitivity: 'internal',
        storage_mode: 'indexed',
      },
      provenance: {},
    });
    expect(upgraded.schema_version).toBe('1.1');
    expect(upgraded.change_state).toBe('upsert');
    expect(upgraded.ingestion_adapter).toBe('manual');

    const parsed = parseSourceEventEnvelope({
      ...upgraded,
      change_state: 'delete',
      ingestion_adapter: 'webhook',
    });
    expect(parsed.change_state).toBe('delete');
    expect(parsed.ingestion_adapter).toBe('webhook');
  });

  it('builds stable adapter-scoped idempotency keys', () => {
    const a = buildSourceEventIdempotencyKey({
      adapter: 'polling',
      provider: 'github',
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      externalId: 'issue:1',
      externalVersion: '3',
    });
    const b = buildSourceEventIdempotencyKey({
      adapter: 'polling',
      provider: 'github',
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      externalId: 'issue:1',
      externalVersion: '3',
    });
    expect(a).toBe(b);
    expect(a).toContain('polling/github/');
  });
});

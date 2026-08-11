import { describe, expect, it } from 'vitest';
import { ingestionEnvelopeSchema } from './ingestion.js';

describe('ingestionEnvelopeSchema', () => {
  it('accepts baseline manual envelope', () => {
    const parsed = ingestionEnvelopeSchema.parse({
      schema_version: '1.0',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      source: { provider: 'manual' },
      event_type: 'memory.decision.created',
      observed_at: '2026-08-09T10:30:00.000Z',
      idempotency_key: 'manual/chatgpt/decision-slice-01',
      content: { text: 'Slice 01 starts after audit PR #215.' },
      scope: {
        project_id: '44444444-4444-4444-8444-444444444401',
        sensitivity: 'internal',
        storage_mode: 'indexed',
      },
    });
    expect(parsed.source.provider).toBe('manual');
    expect(parsed.scope.sensitivity).toBe('internal');
  });

  it('rejects missing idempotency_key', () => {
    expect(() =>
      ingestionEnvelopeSchema.parse({
        schema_version: '1.0',
        workspace_id: '11111111-1111-4111-8111-111111111111',
        source: { provider: 'manual' },
        event_type: 'x',
        observed_at: '2026-08-09T10:30:00.000Z',
      }),
    ).toThrow();
  });
});

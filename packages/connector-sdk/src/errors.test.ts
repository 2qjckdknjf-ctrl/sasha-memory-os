import { describe, expect, it } from 'vitest';
import { classifyConnectorError, connectorRateLimitError } from './errors.js';

describe('classifyConnectorError', () => {
  it('keeps typed connector rate limits retryable', () => {
    const classified = classifyConnectorError(
      connectorRateLimitError({
        message: 'Synthetic 429',
        retryAfterMs: 60_000,
      }),
    );

    expect(classified.kind).toBe('rate_limit');
    expect(classified.retryable).toBe(true);
    expect(classified.retryAfterMs).toBe(60_000);
  });

  it('treats bare HTTP 429 messages as retryable rate limits', () => {
    const classified = classifyConnectorError(new Error('GitHub events API failed: HTTP 429'));

    expect(classified.kind).toBe('rate_limit');
    expect(classified.retryable).toBe(true);
    expect(classified.statusCode).toBe(429);
  });

  it('preserves safe structured diagnostics instead of writing object coercion noise', () => {
    const classified = classifyConnectorError({
      message: 'RPC rejected the connector update',
      code: 'PGRST202',
      details: 'Function signature did not match',
      hint: 'Refresh the schema cache',
      access_token: 'must-not-be-serialized',
    });

    expect(classified.message).toContain('RPC rejected the connector update');
    expect(classified.message).toContain('PGRST202');
    expect(classified.message).not.toContain('[object Object]');
    expect(classified.message).not.toContain('must-not-be-serialized');
  });
});

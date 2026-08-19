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
});

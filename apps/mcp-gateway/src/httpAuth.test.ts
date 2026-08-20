import { describe, expect, it } from 'vitest';
import {
  extractMcpHttpApiSecret,
  isMcpHttpAuthRequired,
  mcpHttpApiSecretMatches,
} from './httpAuth.js';

describe('mcpHttpAuth', () => {
  it('defaults to off in local and test, then on outside them', () => {
    expect(isMcpHttpAuthRequired({ MEMORY_OS_ENV: 'local' })).toBe(false);
    expect(isMcpHttpAuthRequired({ MEMORY_OS_ENV: 'test' })).toBe(false);
    expect(isMcpHttpAuthRequired({ MEMORY_OS_ENV: 'staging' })).toBe(true);
    expect(isMcpHttpAuthRequired({ MEMORY_OS_ENV: 'production' })).toBe(true);
  });

  it('honors explicit auth override flags', () => {
    expect(
      isMcpHttpAuthRequired({
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_REQUIRE_API_AUTH: '1',
      }),
    ).toBe(true);
    expect(
      isMcpHttpAuthRequired({
        MEMORY_OS_ENV: 'staging',
        MEMORY_OS_REQUIRE_API_AUTH: '0',
      }),
    ).toBe(false);
  });

  it('extracts secret from x-memory-os-api-secret or bearer auth', () => {
    expect(
      extractMcpHttpApiSecret({
        'x-memory-os-api-secret': ' direct-secret ',
      }),
    ).toBe('direct-secret');
    expect(
      extractMcpHttpApiSecret({
        authorization: 'Bearer bearer-secret',
      }),
    ).toBe('bearer-secret');
    expect(
      extractMcpHttpApiSecret({
        authorization: 'Bearer    ',
      }),
    ).toBeNull();
  });

  it('matches only the configured secret when auth is enforced', () => {
    expect(
      mcpHttpApiSecretMatches('correct-secret', {
        MEMORY_OS_API_SECRET: 'correct-secret',
      }),
    ).toBe(true);
    expect(
      mcpHttpApiSecretMatches('wrong-secret', {
        MEMORY_OS_API_SECRET: 'correct-secret',
      }),
    ).toBe(false);
    expect(
      mcpHttpApiSecretMatches(null, {
        MEMORY_OS_API_SECRET: 'correct-secret',
      }),
    ).toBe(false);
  });
});

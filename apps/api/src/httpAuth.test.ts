import { describe, expect, it } from 'vitest';
import {
  httpApiSecretMatches,
  isHttpApiAuthRequired,
} from './httpAuth.js';

describe('httpApiAuth', () => {
  it('defaults to off in local/test', () => {
    expect(isHttpApiAuthRequired({ MEMORY_OS_ENV: 'local' })).toBe(false);
    expect(isHttpApiAuthRequired({ MEMORY_OS_ENV: 'test' })).toBe(false);
  });

  it('defaults to on outside local/test', () => {
    expect(isHttpApiAuthRequired({ MEMORY_OS_ENV: 'staging' })).toBe(true);
    expect(isHttpApiAuthRequired({ MEMORY_OS_ENV: 'production' })).toBe(true);
  });

  it('honors explicit override', () => {
    expect(
      isHttpApiAuthRequired({
        MEMORY_OS_ENV: 'local',
        MEMORY_OS_REQUIRE_API_AUTH: '1',
      }),
    ).toBe(true);
    expect(
      isHttpApiAuthRequired({
        MEMORY_OS_ENV: 'staging',
        MEMORY_OS_REQUIRE_API_AUTH: '0',
      }),
    ).toBe(false);
  });

  it('matches configured secret', () => {
    expect(
      httpApiSecretMatches('s3cret', { MEMORY_OS_API_SECRET: 's3cret' }),
    ).toBe(true);
    expect(
      httpApiSecretMatches('nope', { MEMORY_OS_API_SECRET: 's3cret' }),
    ).toBe(false);
  });
});

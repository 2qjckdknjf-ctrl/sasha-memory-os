import { describe, expect, it } from 'vitest';
import { assertSafePublicUrl } from './fetchLink.js';

describe('assertSafePublicUrl', () => {
  it('rejects localhost and credentials', async () => {
    await expect(assertSafePublicUrl('http://localhost/x')).rejects.toThrow(
      /blocked host/,
    );
    await expect(
      assertSafePublicUrl('https://user:pass@example.com'),
    ).rejects.toThrow(/credentials/);
  });

  it('rejects private literal IPs', async () => {
    await expect(assertSafePublicUrl('http://127.0.0.1/x')).rejects.toThrow(
      /private/,
    );
    await expect(assertSafePublicUrl('http://10.0.0.5/x')).rejects.toThrow(
      /private/,
    );
  });

  it('accepts public https hostnames after resolution', async () => {
    const url = await assertSafePublicUrl('https://example.com/path');
    expect(url.hostname).toBe('example.com');
  });
});

import { describe, expect, it } from 'vitest';
import { assertSafePublicUrl, stripHtml } from './fetchLink.js';

describe('stripHtml', () => {
  it('uses an HTML parser and drops malformed script/style contents', () => {
    const result = stripHtml(`
      <html>
        <head><title>Safe &amp; useful</title></head>
        <body>
          Visible content
          <script>alert('hidden')</script data-test="forgiving-end-tag">
          <style>.hidden { color: red }</style >
          Final content
        </body>
      </html>
    `);

    expect(result.title).toBe('Safe & useful');
    expect(result.text).toContain('Visible content');
    expect(result.text).toContain('Final content');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color: red');
  });
});

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

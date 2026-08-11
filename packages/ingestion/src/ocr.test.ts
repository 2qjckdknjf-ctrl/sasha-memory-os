import { describe, expect, it } from 'vitest';
import { StubOcrAdapter, createOcrAdapter } from './ocr.js';

describe('StubOcrAdapter', () => {
  it('supports images and refuses recognition until configured', async () => {
    const adapter = createOcrAdapter('stub');
    expect(adapter).toBeInstanceOf(StubOcrAdapter);
    expect(adapter.supports('image/png')).toBe(true);
    await expect(
      adapter.recognize({
        bytes: Buffer.from('x'),
        mimeType: 'image/png',
        filename: 'scan.png',
      }),
    ).rejects.toThrow(/not configured/);
  });
});

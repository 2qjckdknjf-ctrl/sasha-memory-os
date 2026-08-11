import { describe, expect, it } from 'vitest';
import {
  CliTesseractAdapter,
  FixtureOcrAdapter,
  StubOcrAdapter,
  createOcrAdapter,
} from './ocr.js';
import { extractTextFromBytes } from './extract.js';

describe('createOcrAdapter', () => {
  it('defaults to stub', () => {
    expect(createOcrAdapter('stub')).toBeInstanceOf(StubOcrAdapter);
    expect(createOcrAdapter('fixture')).toBeInstanceOf(FixtureOcrAdapter);
    expect(createOcrAdapter('tesseract')).toBeInstanceOf(CliTesseractAdapter);
  });
});

describe('StubOcrAdapter', () => {
  it('supports images and refuses recognition until configured', async () => {
    const adapter = createOcrAdapter('stub');
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

describe('FixtureOcrAdapter', () => {
  it('reads UTF-8 payload as OCR text', async () => {
    const adapter = new FixtureOcrAdapter();
    const result = await adapter.recognize({
      bytes: Buffer.from('Scanned invoice total 42'),
      mimeType: 'image/png',
      filename: 'scan.png',
    });
    expect(result.text).toContain('invoice');
    expect(result.engine).toBe('fixture-ocr');
  });
});

describe('extractTextFromBytes', () => {
  it('OCRs image payloads via fixture engine', async () => {
    const result = await extractTextFromBytes({
      filename: 'note.png',
      mimeType: 'image/png',
      bytes: Buffer.from('Hello from scanned note'),
      ocr: new FixtureOcrAdapter(),
    });
    expect(result.engine).toBe('fixture-ocr');
    expect(result.text).toContain('scanned note');
  });
});

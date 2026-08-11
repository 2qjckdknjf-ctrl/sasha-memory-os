import { describe, expect, it } from 'vitest';
import { decodeBase64Document, parseDocument, resolveMimeType } from './parsers.js';
import { chunkText } from './chunk.js';

describe('resolveMimeType', () => {
  it('maps extensions', () => {
    expect(resolveMimeType('note.txt')).toBe('text/plain');
    expect(resolveMimeType('brief.pdf')).toBe('application/pdf');
    expect(resolveMimeType('spec.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});

describe('parseDocument', () => {
  it('parses plain text', async () => {
    const result = await parseDocument({
      filename: 'note.txt',
      bytes: Buffer.from('Hello Memory OS', 'utf8'),
    });
    expect(result.text).toContain('Hello Memory OS');
  });

  it('decodes data-url base64', () => {
    const buf = decodeBase64Document(
      `data:text/plain;base64,${Buffer.from('abc').toString('base64')}`,
    );
    expect(buf.toString('utf8')).toBe('abc');
  });
});

describe('chunkText', () => {
  it('splits long text', () => {
    expect(chunkText('a'.repeat(2500), 1200).length).toBe(3);
  });
});

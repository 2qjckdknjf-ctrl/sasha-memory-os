import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
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

  it('parses DOCX text without invoking a document CLI dependency', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body><w:p><w:r><w:t>Hello Memory OS</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await parseDocument({ filename: 'brief.docx', bytes });

    expect(result.text).toBe('Hello Memory OS\nSecond paragraph');
  });

  it('rejects a DOCX document XML doctype', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><!DOCTYPE document [<!ENTITY x "unsafe">]>' +
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      parseDocument({ filename: 'unsafe.docx', bytes }),
    ).rejects.toThrow(/DOCTYPE/);
  });

  it('isolates empty and oversized poison inputs', async () => {
    await expect(
      parseDocument({ filename: 'empty.txt', bytes: Buffer.alloc(0) }),
    ).rejects.toThrow(/empty document/);
    await expect(
      parseDocument({
        filename: 'huge.txt',
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it('rejects unsupported mime as poison', async () => {
    await expect(
      parseDocument({
        filename: 'x.exe',
        mimeType: 'application/octet-stream' as never,
        bytes: Buffer.from('MZ'),
      }),
    ).rejects.toThrow(/unsupported document type/);
  });
});

describe('chunkText', () => {
  it('splits long text', () => {
    expect(chunkText('a'.repeat(2500), 1200).length).toBe(3);
  });
});

import JSZip from 'jszip';
import pdfParse from 'pdf-parse';
import { SaxesParser } from 'saxes';

export type SupportedMime =
  | 'text/plain'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type ParseResult = {
  text: string;
  mimeType: SupportedMime;
  filename: string;
  pageHint?: number;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT: Record<string, SupportedMime> = {
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function resolveMimeType(
  filename: string,
  mimeType?: string | null,
): SupportedMime {
  const normalized = (mimeType ?? '').toLowerCase().split(';')[0]?.trim();
  if (
    normalized === 'text/plain' ||
    normalized === 'application/pdf' ||
    normalized ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return normalized;
  }
  const lower = filename.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    if (lower.endsWith(ext)) return mime;
  }
  throw new Error(`unsupported document type for ${filename}`);
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const documentXml = zip.file('word/document.xml');
  if (!documentXml) throw new Error('DOCX is missing word/document.xml');

  const declaredSize = (
    documentXml as unknown as { _data?: { uncompressedSize?: number } }
  )._data?.uncompressedSize;
  if (declaredSize && declaredSize > MAX_DOCX_XML_BYTES) {
    throw new Error(`DOCX XML exceeds ${MAX_DOCX_XML_BYTES} bytes`);
  }

  const xml = await documentXml.async('string');
  if (Buffer.byteLength(xml, 'utf8') > MAX_DOCX_XML_BYTES) {
    throw new Error(`DOCX XML exceeds ${MAX_DOCX_XML_BYTES} bytes`);
  }

  const output: string[] = [];
  let inTextNode = false;
  const parser = new SaxesParser({ xmlns: false });
  const localName = (name: string) => name.split(':').at(-1) ?? name;

  parser.on('doctype', () => {
    throw new Error('DOCX document.xml must not contain a DOCTYPE');
  });
  parser.on('opentag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') inTextNode = true;
    if (name === 'tab') output.push('\t');
    if (name === 'br' || name === 'cr') output.push('\n');
  });
  parser.on('text', (text) => {
    if (inTextNode) output.push(text);
  });
  parser.on('cdata', (text) => {
    if (inTextNode) output.push(text);
  });
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') inTextNode = false;
    if (name === 'tc') output.push('\t');
    if (name === 'p') output.push('\n');
  });
  parser.write(xml).close();

  return output
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function parseDocument(input: {
  filename: string;
  mimeType?: string | null;
  bytes: Buffer | Uint8Array;
}): Promise<ParseResult> {
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes);
  if (bytes.byteLength === 0) {
    throw new Error('empty document');
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`document exceeds ${MAX_BYTES} bytes`);
  }

  const mimeType = resolveMimeType(input.filename, input.mimeType);

  switch (mimeType) {
    case 'text/plain': {
      return {
        text: bytes.toString('utf8').trim(),
        mimeType,
        filename: input.filename,
      };
    }
    case 'application/pdf': {
      const parsed = await pdfParse(bytes);
      const text = (parsed.text ?? '').replace(/\s+\n/g, '\n').trim();
      if (!text) throw new Error('no extractable text in PDF');
      return {
        text,
        mimeType,
        filename: input.filename,
        pageHint: parsed.numpages,
      };
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const text = await extractDocxText(bytes);
      if (!text) throw new Error('no extractable text in DOCX');
      return {
        text,
        mimeType,
        filename: input.filename,
      };
    }
    default: {
      const _exhaustive: never = mimeType;
      throw new Error(`unsupported mime: ${_exhaustive}`);
    }
  }
}

export function decodeBase64Document(contentBase64: string): Buffer {
  const cleaned = contentBase64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.byteLength === 0) throw new Error('invalid base64 document');
  return buf;
}

import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

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
      const parsed = await mammoth.extractRawText({ buffer: bytes });
      const text = (parsed.value ?? '').trim();
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

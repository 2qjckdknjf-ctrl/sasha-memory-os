import { createOcrAdapter, type OcrAdapter } from './ocr.js';
import {
  parseDocument,
  resolveMimeType,
  type ParseResult,
  type SupportedMime,
} from './parsers.js';

export type ExtractResult = ParseResult & {
  engine: 'native' | string;
};

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp'];

export function looksLikeImage(filename: string, mimeType?: string | null): boolean {
  const normalized = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized.startsWith('image/')) return true;
  const lower = filename.toLowerCase();
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * Parse native text documents, or OCR images when an engine is configured.
 */
export async function extractTextFromBytes(input: {
  filename: string;
  mimeType?: string | null;
  bytes: Buffer | Uint8Array;
  ocr?: OcrAdapter;
}): Promise<ExtractResult> {
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes);

  if (looksLikeImage(input.filename, input.mimeType)) {
    const ocr = input.ocr ?? createOcrAdapter();
    const mime =
      (input.mimeType ?? '').toLowerCase().split(';')[0]?.trim() || 'image/png';
    if (!ocr.supports(mime)) {
      throw new Error(`OCR engine ${ocr.name} does not support ${mime}`);
    }
    const result = await ocr.recognize({
      bytes,
      mimeType: mime,
      filename: input.filename,
    });
    return {
      text: result.text,
      mimeType: 'text/plain' as SupportedMime,
      filename: input.filename,
      engine: result.engine,
    };
  }

  // Scanned PDF with no text: try native parse first, then OCR if configured.
  try {
    const parsed = await parseDocument({
      filename: input.filename,
      mimeType: input.mimeType,
      bytes,
    });
    return { ...parsed, engine: 'native' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const mime = (() => {
      try {
        return resolveMimeType(input.filename, input.mimeType);
      } catch {
        return null;
      }
    })();
    if (mime === 'application/pdf' && /no extractable text/i.test(message)) {
      const ocr = input.ocr ?? createOcrAdapter();
      if (ocr.name === 'stub-ocr') throw err;
      if (!ocr.supports('application/pdf')) throw err;
      const result = await ocr.recognize({
        bytes,
        mimeType: 'application/pdf',
        filename: input.filename,
      });
      return {
        text: result.text,
        mimeType: 'application/pdf',
        filename: input.filename,
        engine: result.engine,
      };
    }
    throw err;
  }
}

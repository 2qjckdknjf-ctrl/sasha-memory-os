export type OcrInput = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
};

export type OcrResult = {
  text: string;
  engine: string;
  confidence?: number;
};

export interface OcrAdapter {
  readonly name: string;
  supports(mimeType: string): boolean;
  recognize(input: OcrInput): Promise<OcrResult>;
}

/** Placeholder until a real OCR provider is configured (Tesseract/cloud). */
export class StubOcrAdapter implements OcrAdapter {
  readonly name = 'stub-ocr';

  supports(mimeType: string): boolean {
    return (
      mimeType.startsWith('image/') || mimeType === 'application/pdf'
    );
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    void input;
    throw new Error(
      'OCR adapter not configured; provide MEMORY_OS_OCR_ENGINE or use text PDF/DOCX',
    );
  }
}

export function createOcrAdapter(engine = process.env.MEMORY_OS_OCR_ENGINE): OcrAdapter {
  switch (engine ?? 'stub') {
    case 'stub':
      return new StubOcrAdapter();
    default: {
      // Unknown engines fall back to stub with explicit name for logs.
      return new StubOcrAdapter();
    }
  }
}

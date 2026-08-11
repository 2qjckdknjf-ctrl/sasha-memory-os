import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

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

function isOcrableMime(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf';
}

/** Placeholder until a real OCR provider is configured (Tesseract/cloud). */
export class StubOcrAdapter implements OcrAdapter {
  readonly name = 'stub-ocr';

  supports(mimeType: string): boolean {
    return isOcrableMime(mimeType);
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    void input;
    throw new Error(
      'OCR adapter not configured; provide MEMORY_OS_OCR_ENGINE=tesseract|fixture or use text PDF/DOCX',
    );
  }
}

/**
 * Test/dev adapter: interprets image/PDF bytes as UTF-8 text when content looks textual.
 * Useful for golden/fixture captures without installing Tesseract.
 */
export class FixtureOcrAdapter implements OcrAdapter {
  readonly name = 'fixture-ocr';

  supports(mimeType: string): boolean {
    return isOcrableMime(mimeType);
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    const text = input.bytes.toString('utf8').replace(/\0/g, '').trim();
    if (!text || text.length < 2) {
      throw new Error('fixture OCR: no UTF-8 text in payload');
    }
    // Reject mostly binary payloads (high ratio of non-printable).
    const printable = text.replace(/[\x09\x0a\x0d\x20-\x7e\u0400-\u04FF]/g, '');
    if (printable.length / text.length > 0.2) {
      throw new Error('fixture OCR: payload looks binary');
    }
    return { text, engine: this.name, confidence: 0.5 };
  }
}

/** Shells out to system `tesseract` CLI when installed. */
export class CliTesseractAdapter implements OcrAdapter {
  readonly name = 'tesseract-cli';

  supports(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    const dir = join(tmpdir(), `memory-os-ocr-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.'))
      : '.png';
    const imagePath = join(dir, `scan${ext}`);
    const outBase = join(dir, 'out');
    try {
      await writeFile(imagePath, input.bytes);
      const text = await runTesseract(imagePath, outBase);
      if (!text.trim()) {
        throw new Error('tesseract returned empty text');
      }
      return { text: text.trim(), engine: this.name };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function runTesseract(imagePath: string, outBase: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tesseract', [imagePath, outBase, '-l', 'eng+rus'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      reject(
        new Error(
          `tesseract CLI unavailable (${err.message}); install tesseract or use MEMORY_OS_OCR_ENGINE=fixture`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`tesseract failed (${code}): ${stderr.trim()}`));
        return;
      }
      void readFile(`${outBase}.txt`, 'utf8')
        .then(resolve)
        .catch((err: Error) => reject(err));
    });
  });
}

export function createOcrAdapter(
  engine = process.env.MEMORY_OS_OCR_ENGINE,
): OcrAdapter {
  switch (engine ?? 'stub') {
    case 'stub':
      return new StubOcrAdapter();
    case 'fixture':
      return new FixtureOcrAdapter();
    case 'tesseract':
      return new CliTesseractAdapter();
    default: {
      return new StubOcrAdapter();
    }
  }
}

export type TranscriptionInput = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
};

export type TranscriptionResult = {
  text: string;
  engine: string;
  language?: string;
  durationHintSec?: number;
};

export interface TranscriptionAdapter {
  readonly name: string;
  supports(mimeType: string): boolean;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
]);

export function isAudioMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return normalized.startsWith('audio/') || AUDIO_MIMES.has(normalized);
}

/** Placeholder until Whisper/cloud STT is configured. */
export class StubTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = 'stub-transcription';

  supports(mimeType: string): boolean {
    return isAudioMime(mimeType);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    void input;
    throw new Error(
      'Transcription adapter not configured; set MEMORY_OS_TRANSCRIBE_ENGINE=fixture|openai',
    );
  }
}

/**
 * Dev/test adapter: treat UTF-8 audio payload bytes as transcript text
 * (fixtures only — not for real media).
 */
export class FixtureTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = 'fixture-transcription';

  supports(mimeType: string): boolean {
    return isAudioMime(mimeType);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const text = input.bytes.toString('utf8').replace(/\0/g, '').trim();
    if (!text || text.length < 2) {
      throw new Error('fixture transcription: no UTF-8 text in payload');
    }
    return { text, engine: this.name, language: 'und' };
  }
}

/** OpenAI Whisper / audio.transcriptions API. */
export class OpenAiTranscriptionAdapter implements TranscriptionAdapter {
  readonly name = 'openai-transcription';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'whisper-1';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  supports(mimeType: string): boolean {
    return isAudioMime(mimeType);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    const bytes = new Uint8Array(input.bytes);
    form.append(
      'file',
      new Blob([bytes], { type: input.mimeType || 'audio/mpeg' }),
      input.filename || 'audio.mp3',
    );
    form.append('model', this.model);
    const response = await this.fetchImpl(
      `${this.baseUrl}/audio/transcriptions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
      },
    );
    if (!response.ok) {
      throw new Error(`OpenAI transcription failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };
    const text = (payload.text ?? '').trim();
    if (!text) {
      throw new Error('OpenAI transcription returned empty text');
    }
    return {
      text,
      engine: this.name,
      language: payload.language,
      durationHintSec:
        typeof payload.duration === 'number' ? payload.duration : undefined,
    };
  }
}

export function createTranscriptionAdapter(
  env: NodeJS.ProcessEnv = process.env,
  options?: { fetchImpl?: typeof fetch },
): TranscriptionAdapter {
  const engine = (env.MEMORY_OS_TRANSCRIBE_ENGINE ?? 'stub').trim().toLowerCase();
  switch (engine) {
    case 'fixture':
      return new FixtureTranscriptionAdapter();
    case 'openai': {
      const apiKey = env.MEMORY_OS_OPENAI_API_KEY?.trim();
      if (!apiKey) {
        const strict =
          (env.MEMORY_OS_TRANSCRIBE_STRICT ?? '').trim() === '1' ||
          (env.MEMORY_OS_TRANSCRIBE_STRICT ?? '').trim().toLowerCase() ===
            'true';
        if (strict) {
          throw new Error(
            'MEMORY_OS_TRANSCRIBE_ENGINE=openai requires MEMORY_OS_OPENAI_API_KEY',
          );
        }
        return new StubTranscriptionAdapter();
      }
      return new OpenAiTranscriptionAdapter({
        apiKey,
        model: env.MEMORY_OS_TRANSCRIBE_MODEL?.trim() || 'whisper-1',
        baseUrl: env.MEMORY_OS_OPENAI_BASE_URL?.trim() || undefined,
        fetchImpl: options?.fetchImpl,
      });
    }
    case 'stub':
    case '':
      return new StubTranscriptionAdapter();
    default:
      return new StubTranscriptionAdapter();
  }
}

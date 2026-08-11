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
      'Transcription adapter not configured; set MEMORY_OS_TRANSCRIBE_ENGINE=fixture|openai later',
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

export function createTranscriptionAdapter(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionAdapter {
  const engine = (env.MEMORY_OS_TRANSCRIBE_ENGINE ?? 'stub').trim().toLowerCase();
  switch (engine) {
    case 'fixture':
      return new FixtureTranscriptionAdapter();
    case 'stub':
    case '':
      return new StubTranscriptionAdapter();
    default:
      return new StubTranscriptionAdapter();
  }
}

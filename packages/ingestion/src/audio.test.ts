import { describe, expect, it } from 'vitest';
import {
  createTranscriptionAdapter,
  FixtureTranscriptionAdapter,
  isAudioMime,
  StubTranscriptionAdapter,
} from './audio.js';

describe('transcription adapters', () => {
  it('detects audio mime types', () => {
    expect(isAudioMime('audio/mpeg')).toBe(true);
    expect(isAudioMime('text/plain')).toBe(false);
  });

  it('stub refuses until configured', async () => {
    const stub = new StubTranscriptionAdapter();
    await expect(
      stub.transcribe({
        bytes: Buffer.from('hi'),
        mimeType: 'audio/mpeg',
        filename: 'a.mp3',
      }),
    ).rejects.toThrow(/not configured/);
  });

  it('fixture returns UTF-8 transcript', async () => {
    const fixture = new FixtureTranscriptionAdapter();
    const result = await fixture.transcribe({
      bytes: Buffer.from('meeting notes from voice memo', 'utf8'),
      mimeType: 'audio/wav',
      filename: 'memo.wav',
    });
    expect(result.engine).toBe('fixture-transcription');
    expect(result.text).toContain('voice memo');
  });

  it('factory respects MEMORY_OS_TRANSCRIBE_ENGINE', () => {
    expect(createTranscriptionAdapter({ MEMORY_OS_TRANSCRIBE_ENGINE: 'fixture' }).name).toBe(
      'fixture-transcription',
    );
    expect(createTranscriptionAdapter({ MEMORY_OS_TRANSCRIBE_ENGINE: 'stub' }).name).toBe(
      'stub-transcription',
    );
  });
});

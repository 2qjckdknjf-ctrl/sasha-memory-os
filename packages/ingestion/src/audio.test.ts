import { describe, expect, it, vi } from 'vitest';
import {
  createTranscriptionAdapter,
  FixtureTranscriptionAdapter,
  isAudioMime,
  OpenAiTranscriptionAdapter,
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

  it('openai adapter posts multipart and returns text', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ text: 'hello from whisper', language: 'en', duration: 1.2 }),
    );
    const adapter = new OpenAiTranscriptionAdapter({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.transcribe({
      bytes: Buffer.from('fake-audio'),
      mimeType: 'audio/mpeg',
      filename: 'clip.mp3',
    });
    expect(result.text).toBe('hello from whisper');
    expect(result.engine).toBe('openai-transcription');
    expect(result.language).toBe('en');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    expect(String(call[0])).toContain('/audio/transcriptions');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBeInstanceOf(FormData);
  });

  it('factory respects MEMORY_OS_TRANSCRIBE_ENGINE', () => {
    expect(
      createTranscriptionAdapter({ MEMORY_OS_TRANSCRIBE_ENGINE: 'fixture' }).name,
    ).toBe('fixture-transcription');
    expect(
      createTranscriptionAdapter({ MEMORY_OS_TRANSCRIBE_ENGINE: 'stub' }).name,
    ).toBe('stub-transcription');
    expect(
      createTranscriptionAdapter({
        MEMORY_OS_TRANSCRIBE_ENGINE: 'openai',
        MEMORY_OS_OPENAI_API_KEY: 'sk-x',
      }).name,
    ).toBe('openai-transcription');
    expect(
      createTranscriptionAdapter({
        MEMORY_OS_TRANSCRIBE_ENGINE: 'openai',
      }).name,
    ).toBe('stub-transcription');
  });
});

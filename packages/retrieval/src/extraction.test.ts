import { describe, expect, it, vi } from 'vitest';
import {
  createExtractionAdapter,
  FixtureExtractionAdapter,
  OpenAiExtractionAdapter,
  StubExtractionAdapter,
} from './extraction.js';

describe('extraction adapters', () => {
  it('stub returns a single candidate', async () => {
    const stub = new StubExtractionAdapter();
    const result = await stub.extract({
      title: 'Note',
      text: 'We chose Supabase for Memory OS.',
    });
    expect(result.engine).toBe('stub-extraction');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.content).toContain('Supabase');
  });

  it('fixture splits blank-line blocks', async () => {
    const fixture = new FixtureExtractionAdapter();
    const result = await fixture.extract({
      text: 'First fact about ACL.\n\nSecond fact about vault tokens.',
    });
    expect(result.candidates).toHaveLength(2);
  });

  it('openai adapter parses JSON candidates', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidates: [
                  {
                    title: 'Region',
                    content: 'Primary region is eu-central-1',
                    memoryType: 'fact',
                    confidence: 0.9,
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    const adapter = new OpenAiExtractionAdapter({
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.extract({
      text: 'Primary region is eu-central-1',
    });
    expect(result.engine).toBe('openai-extraction');
    expect(result.candidates[0]?.title).toBe('Region');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('factory respects MEMORY_OS_EXTRACT_ENGINE', () => {
    expect(
      createExtractionAdapter({ MEMORY_OS_EXTRACT_ENGINE: 'fixture' }).name,
    ).toBe('fixture-extraction');
    expect(
      createExtractionAdapter({
        MEMORY_OS_EXTRACT_ENGINE: 'openai',
        MEMORY_OS_OPENAI_API_KEY: 'sk-x',
      }).name,
    ).toBe('openai-extraction');
    expect(
      createExtractionAdapter({ MEMORY_OS_EXTRACT_ENGINE: 'openai' }).name,
    ).toBe('stub-extraction');
  });
});

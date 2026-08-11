import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.js';

describe('chunkText', () => {
  it('returns one chunk for short text', () => {
    expect(chunkText('hello memory').length).toBe(1);
  });

  it('splits long text', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkText(text, 1200);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.content.length).toBe(1200);
  });
});

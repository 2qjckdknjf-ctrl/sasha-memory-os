import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.js';

describe('chunkText re-export', () => {
  it('splits long text', () => {
    expect(chunkText('a'.repeat(2500), 1200).length).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveLocalSubject } from './subjects.js';

describe('resolveLocalSubject', () => {
  it('maps actor keys and demo clients', () => {
    expect(resolveLocalSubject({ actorKey: 'cursor' })?.externalKey).toBe(
      'cursor',
    );
    expect(resolveLocalSubject({ actorKey: 'roma' })?.id).toBe(
      '33333333-3333-4333-8333-333333333304',
    );
    expect(resolveLocalSubject({ clientId: 'demo-chatgpt' })?.id).toBe(
      '33333333-3333-4333-8333-333333333302',
    );
    expect(resolveLocalSubject({ clientId: 'demo-roma' })?.externalKey).toBe(
      'roma',
    );
  });
});

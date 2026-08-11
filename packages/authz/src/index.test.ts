import { describe, expect, it } from 'vitest';
import { authorize, type AuthzContext } from './index.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const cursor = '33333333-3333-4333-8333-333333333303';

const cursorCtx: AuthzContext = {
  subjectId: cursor,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  isOwner: false,
  entries: [
    {
      subjectId: cursor,
      effect: 'allow',
      resourceType: 'memory',
      projectId,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
  ],
};

describe('authorize', () => {
  it('allows cursor internal project memory', () => {
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'internal',
      }),
    ).toBe(true);
  });

  it('denies cursor personal memory', () => {
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'personal',
      }),
    ).toBe(false);
  });

  it('denies wrong project', () => {
    expect(
      authorize(cursorCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId: '00000000-0000-4000-8000-000000000099',
        sensitivity: 'internal',
      }),
    ).toBe(false);
  });
});

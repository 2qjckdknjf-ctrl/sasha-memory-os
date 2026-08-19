import { describe, expect, it } from 'vitest';
import { authorize, type AuthzContext } from './index.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const cursor = '33333333-3333-4333-8333-333333333303';
const roma = '33333333-3333-4333-8333-333333333304';

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

const romaCtx: AuthzContext = {
  subjectId: roma,
  workspaceId: '11111111-1111-4111-8111-111111111111',
  isOwner: false,
  entries: [
    {
      subjectId: roma,
      effect: 'allow',
      resourceType: 'memory',
      projectId,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: roma,
      effect: 'allow',
      resourceType: 'handoff',
      projectId,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
  ],
};

const workspaceWriterCtx: AuthzContext = {
  subjectId: '33333333-3333-4333-8333-333333333302',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  isOwner: false,
  entries: [
    {
      subjectId: '33333333-3333-4333-8333-333333333302',
      effect: 'allow',
      resourceType: 'memory',
      projectId: null,
      actions: ['write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: '33333333-3333-4333-8333-333333333302',
      effect: 'allow',
      resourceType: 'handoff',
      projectId: null,
      actions: ['write'],
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

  it('lets roma read assigned project memory', () => {
    expect(
      authorize(romaCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'internal',
      }),
    ).toBe(true);
  });

  it('denies roma personal and restricted memory', () => {
    expect(
      authorize(romaCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'personal',
      }),
    ).toBe(false);
    expect(
      authorize(romaCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'restricted',
      }),
    ).toBe(false);
  });

  it('denies roma on unrelated project', () => {
    expect(
      authorize(romaCtx, {
        resourceType: 'memory',
        action: 'read',
        projectId: '00000000-0000-4000-8000-000000000099',
        sensitivity: 'internal',
      }),
    ).toBe(false);
  });

  it('does not let workspace-scoped ACL write an unrelated concrete project', () => {
    expect(
      authorize(workspaceWriterCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId,
        sensitivity: 'internal',
      }),
    ).toBe(false);
  });

  it('allows workspace-level write with a workspace-scoped ACL', () => {
    expect(
      authorize(workspaceWriterCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: null,
        sensitivity: 'internal',
      }),
    ).toBe(true);
    expect(
      authorize(workspaceWriterCtx, {
        resourceType: 'handoff',
        action: 'write',
        projectId: null,
      }),
    ).toBe(true);
  });

  it('keeps chatgpt from writing an ungranted concrete project', () => {
    expect(
      authorize(workspaceWriterCtx, {
        resourceType: 'memory',
        action: 'write',
        projectId: '00000000-0000-4000-8000-000000000099',
        sensitivity: 'internal',
      }),
    ).toBe(false);
  });
});

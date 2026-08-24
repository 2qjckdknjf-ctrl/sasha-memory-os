import { describe, expect, it } from 'vitest';
import {
  AISTROYKA_PROJECT_ID,
  CHATGPT_SUBJECT_ID,
  CURSOR_SUBJECT_ID,
  HIAIR_PROJECT_ID,
  SASHA_MEMORY_OS_PROJECT_ID,
} from '@memory-os/schemas';
import { authorize, type AuthzContext } from './index.js';
import {
  applyP0AclRemediation,
  buildLegacyPreP0AclEntries,
  buildProductionAgentAclEntries,
  P0_ACL_TEST_PROJECTS,
} from './productionAcl.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

function ctxFor(subjectId: string, entries: AuthzContext['entries']): AuthzContext {
  return { subjectId, workspaceId, isOwner: false, entries };
}

function can(
  subjectId: string,
  entries: AuthzContext['entries'],
  resourceType: string,
  action: string,
  projectId: string | null,
): boolean {
  return authorize(ctxFor(subjectId, entries), {
    resourceType,
    action,
    projectId,
    sensitivity: 'internal',
  });
}

describe('P0 production ACL', () => {
  const production = buildProductionAgentAclEntries();
  const legacy = buildLegacyPreP0AclEntries();
  const remediated = applyP0AclRemediation(legacy);
  const remediatedTwice = applyP0AclRemediation(remediated);

  it('exports stable test project anchors', () => {
    expect(P0_ACL_TEST_PROJECTS.memoryOs).toBe(SASHA_MEMORY_OS_PROJECT_ID);
    expect(P0_ACL_TEST_PROJECTS.aistroyka).toBe(AISTROYKA_PROJECT_ID);
    expect(P0_ACL_TEST_PROJECTS.hiair).toBe(HIAIR_PROJECT_ID);
  });

  it('models legacy upgrade state with Cursor AISTROYKA write and workspace-wide bypass', () => {
    expect(
      can(CURSOR_SUBJECT_ID, legacy, 'memory', 'write', AISTROYKA_PROJECT_ID),
    ).toBe(true);
    expect(
      can(CURSOR_SUBJECT_ID, legacy, 'memory', 'write', null),
    ).toBe(true);
    expect(
      can(CHATGPT_SUBJECT_ID, legacy, 'handoff', 'write', null),
    ).toBe(true);
    expect(
      can(CURSOR_SUBJECT_ID, legacy, 'memory', 'write', HIAIR_PROJECT_ID),
    ).toBe(false);
  });

  it('denies Cursor on AISTROYKA and HiAir after P0 remediation', () => {
    for (const projectId of [AISTROYKA_PROJECT_ID, HIAIR_PROJECT_ID]) {
      expect(
        can(CURSOR_SUBJECT_ID, remediated, 'memory', 'read', projectId),
      ).toBe(false);
      expect(
        can(CURSOR_SUBJECT_ID, remediated, 'memory', 'write', projectId),
      ).toBe(false);
      expect(
        can(CURSOR_SUBJECT_ID, remediated, 'project_state', 'write', projectId),
      ).toBe(false);
    }
  });

  it('allows Cursor read/write on Memory OS only', () => {
    expect(
      can(CURSOR_SUBJECT_ID, remediated, 'memory', 'read', SASHA_MEMORY_OS_PROJECT_ID),
    ).toBe(true);
    expect(
      can(CURSOR_SUBJECT_ID, remediated, 'memory', 'write', SASHA_MEMORY_OS_PROJECT_ID),
    ).toBe(true);
    expect(
      can(
        CURSOR_SUBJECT_ID,
        remediated,
        'project_state',
        'write',
        SASHA_MEMORY_OS_PROJECT_ID,
      ),
    ).toBe(true);
  });

  it('removes workspace-wide null project bypass for agents', () => {
    expect(can(CURSOR_SUBJECT_ID, remediated, 'memory', 'write', null)).toBe(
      false,
    );
    expect(can(CHATGPT_SUBJECT_ID, remediated, 'handoff', 'write', null)).toBe(
      false,
    );
    expect(
      can(CURSOR_SUBJECT_ID, remediated, 'memory', 'write', HIAIR_PROJECT_ID),
    ).toBe(false);
  });

  it('allows ChatGPT handoff write on Memory OS only', () => {
    expect(
      can(
        CHATGPT_SUBJECT_ID,
        production,
        'handoff',
        'write',
        SASHA_MEMORY_OS_PROJECT_ID,
      ),
    ).toBe(true);
    expect(
      can(
        CHATGPT_SUBJECT_ID,
        remediated,
        'handoff',
        'write',
        SASHA_MEMORY_OS_PROJECT_ID,
      ),
    ).toBe(true);
    expect(
      can(
        CHATGPT_SUBJECT_ID,
        remediated,
        'handoff',
        'write',
        AISTROYKA_PROJECT_ID,
      ),
    ).toBe(false);
  });

  it('keeps ChatGPT project_state read-only on Memory OS', () => {
    expect(
      can(
        CHATGPT_SUBJECT_ID,
        production,
        'project_state',
        'read',
        SASHA_MEMORY_OS_PROJECT_ID,
      ),
    ).toBe(true);
    expect(
      can(
        CHATGPT_SUBJECT_ID,
        production,
        'project_state',
        'write',
        SASHA_MEMORY_OS_PROJECT_ID,
      ),
    ).toBe(false);
  });

  it('remediates idempotently', () => {
    const key = (e: (typeof production)[number]) =>
      `${e.subjectId}|${e.resourceType}|${e.projectId ?? 'null'}|${e.actions.join('+')}`;
    const once = new Map(remediated.map((e) => [key(e), e]));
    const twice = new Map(remediatedTwice.map((e) => [key(e), e]));
    expect(twice.size).toBe(once.size);
    for (const [k, entry] of once) {
      expect(twice.get(k)).toEqual(entry);
    }
  });
});

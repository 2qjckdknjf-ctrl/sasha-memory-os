import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import { searchMemories } from '@memory-os/retrieval';
import { authorize, resolveLocalSubject, type AuthzContext } from '@memory-os/authz';

type GoldenCase = {
  id: string;
  query: string;
  actor: string;
  must_allow: boolean;
  expect_memory_title_includes?: string;
  expect_content_includes?: string;
  expect_empty_or_no_restricted?: boolean;
};

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444401';
const owner = '33333333-3333-4333-8333-333333333301';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const cursor = '33333333-3333-4333-8333-333333333303';

function authzFor(actorKey: string): AuthzContext {
  const subject = resolveLocalSubject({ actorKey });
  if (!subject) throw new Error(`unknown actor ${actorKey}`);
  const isOwner = subject.id === owner;
  return {
    subjectId: subject.id,
    workspaceId,
    isOwner,
    entries: [
      {
        subjectId: chatgpt,
        effect: 'allow',
        resourceType: 'memory',
        projectId,
        actions: ['read', 'write'],
        sensitivityMax: 'internal',
      },
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
}

describe('golden retrieval harness', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, 'golden_retrieval.json'), 'utf8'),
  ) as { cases: GoldenCase[] };
  const store = createSeededStore();
  store.captureText({
    workspaceId,
    projectId,
    title: 'WP-04 capture note',
    text: 'Manual capture path for Memory OS.',
    actorSubjectId: chatgpt,
    idempotencyKey: 'eval/wp04',
  });

  for (const testCase of fixture.cases) {
    it(testCase.id, () => {
      const authz = authzFor(testCase.actor);
      const canRead = authorize(authz, {
        resourceType: 'memory',
        action: 'read',
        projectId,
        sensitivity: 'internal',
      });
      expect(canRead).toBe(testCase.must_allow);

      const hits = searchMemories([...store.memories.values()], testCase.query, {
        projectId,
      }).filter((hit) =>
        authorize(authz, {
          resourceType: 'memory',
          action: 'read',
          projectId: hit.memory.projectId,
          sensitivity: hit.memory.sensitivity,
        }),
      );

      if (testCase.expect_memory_title_includes) {
        expect(
          hits.some((h) =>
            h.memory.title.includes(testCase.expect_memory_title_includes!),
          ),
        ).toBe(true);
      }
      if (testCase.expect_content_includes) {
        expect(
          hits.some((h) =>
            h.memory.content
              .toLowerCase()
              .includes(testCase.expect_content_includes!.toLowerCase()),
          ),
        ).toBe(true);
      }
      if (testCase.expect_empty_or_no_restricted) {
        expect(
          hits.every((h) => h.memory.sensitivity !== 'restricted'),
        ).toBe(true);
      }
    });
  }
});

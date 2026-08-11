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
  expect_no_sensitivity?: string;
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

  const fixtures: Array<{
    title: string;
    text: string;
    actor: string;
    key: string;
    sensitivity?: 'internal' | 'confidential' | 'restricted';
  }> = [
    {
      title: 'WP-04 capture note',
      text: 'Manual capture path for Memory OS with quarantine hash chunks.',
      actor: chatgpt,
      key: 'eval/wp04',
    },
    {
      title: 'AISTROYKA control note',
      text: 'AISTROYKA project uses Memory OS as shared long-term memory.',
      actor: chatgpt,
      key: 'eval/aistroyka',
    },
    {
      title: 'Connector sync plan',
      text: 'Connector sync stub enqueues GitHub jobs without loading vault tokens.',
      actor: owner,
      key: 'eval/connector-sync',
    },
    {
      title: 'OCR invoice note',
      text: 'OCR scanned invoice total recorded for finance review.',
      actor: chatgpt,
      key: 'eval/ocr-invoice',
    },
    {
      title: 'Memory Core ACL note',
      text: 'Memory Core ACL temporal model and provenance for agents.',
      actor: owner,
      key: 'eval/acl',
    },
    {
      title: 'GitHub connection note',
      text: 'GitHub repos connected via broker; vault refs only.',
      actor: chatgpt,
      key: 'eval/github',
    },
    {
      title: 'Link capture note',
      text: 'Link capture uses SSRF-safe fetch for public URLs.',
      actor: cursor,
      key: 'eval/link',
    },
    {
      title: 'OAuth vault note',
      text: 'OAuth callback stores vault refs only, never raw tokens.',
      actor: owner,
      key: 'eval/vault',
    },
    {
      title: 'Auth bind note',
      text: 'Supabase Auth subject bind maps auth user to workspace subject.',
      actor: owner,
      key: 'eval/auth-bind',
    },
    {
      title: 'Ingest pipeline note',
      text: 'processing job ingest turns quarantine artifacts into candidate memories.',
      actor: owner,
      key: 'eval/ingest',
    },
    {
      title: 'Restricted passport (should not leak)',
      text: 'passport number and salary IBAN must stay restricted.',
      actor: owner,
      key: 'eval/restricted',
      sensitivity: 'restricted',
    },
    {
      title: 'Confidential salary band',
      text: 'salary band confidential compensation data for leadership only.',
      actor: owner,
      key: 'eval/confidential-salary',
      sensitivity: 'confidential',
    },
    {
      title: 'ROMA agent note',
      text: 'ROMA agent shares the same Memory Core with ChatGPT and Cursor.',
      actor: chatgpt,
      key: 'eval/roma',
    },
    {
      title: 'Hybrid retrieval note',
      text: 'Hybrid retrieval combines pgvector and FTS for project context.',
      actor: owner,
      key: 'eval/pgvector',
    },
    {
      title: 'DPIA privacy note',
      text: 'Initial DPIA privacy review covers retention and data classes.',
      actor: owner,
      key: 'eval/dpia',
    },
    {
      title: 'Temporal model note',
      text: 'Temporal memory supersedes older facts without deleting provenance.',
      actor: chatgpt,
      key: 'eval/temporal',
    },
    {
      title: 'Correction UX note',
      text: 'Correction review UX lets owner fix mistaken candidate memories.',
      actor: owner,
      key: 'eval/correction',
    },
    {
      title: 'Embedding baseline note',
      text: 'Baseline embedding adapter is swappable without lock-in.',
      actor: owner,
      key: 'eval/embedding',
    },
    {
      title: 'Consolidation worker note',
      text: 'Consolidation worker merges duplicate candidate memories overnight.',
      actor: chatgpt,
      key: 'eval/consolidation',
    },
    {
      title: 'Apple bridge note',
      text: 'Apple bridge connector will sync Notes and Reminders later.',
      actor: owner,
      key: 'eval/apple',
    },
    {
      title: 'Google Drive health note',
      text: 'Google Drive degraded connection needs reauth before file sync.',
      actor: owner,
      key: 'eval/gdrive',
    },
    {
      title: 'Gmail metadata note',
      text: 'Gmail metadata sync indexes labels without storing full bodies by default.',
      actor: chatgpt,
      key: 'eval/gmail',
    },
    {
      title: 'Calendar event note',
      text: 'Google calendar event sync captures meetings as project events.',
      actor: owner,
      key: 'eval/calendar',
    },
    {
      title: 'Provenance chain note',
      text: 'Every candidate memory keeps a provenance chain to source events.',
      actor: owner,
      key: 'eval/provenance',
    },
    {
      title: 'Hosting region note',
      text: 'Dedicated Supabase project runs in eu-central-1 region.',
      actor: owner,
      key: 'eval/region',
    },
    {
      title: 'Outbox reliability note',
      text: 'Reliable delivery uses outbox events for workers and connectors.',
      actor: chatgpt,
      key: 'eval/outbox',
    },
    {
      title: 'Synthetic GitHub PR note',
      text: 'Synthetic GitHub sync invents Pull request #215 without loading tokens.',
      actor: owner,
      key: 'eval/github-pr',
    },
    {
      title: 'Forbidden personal secrets',
      text: 'forbidden personal secrets must not surface to agent actors.',
      actor: owner,
      key: 'eval/forbidden-secrets',
      sensitivity: 'confidential',
    },
    {
      title: 'Embedding adapter note',
      text: 'Stub embedding adapter produces deterministic hash vectors for tests.',
      actor: owner,
      key: 'eval/embedding-adapter',
    },
    {
      title: 'OAuth fingerprint note',
      text: 'OAuth callback stores code fingerprint and vault ref, never raw codes.',
      actor: chatgpt,
      key: 'eval/oauth-fingerprint',
    },
    {
      title: 'Credentials ready note',
      text: 'When CLIENT_ID and CLIENT_SECRET exist, exchangeMode becomes credentials_ready.',
      actor: owner,
      key: 'eval/credentials-ready',
    },
    {
      title: 'Candidate review note',
      text: 'Candidate review queue lets owner approve or reject capture memories.',
      actor: owner,
      key: 'eval/candidate-review',
    },
    {
      title: 'Retract memory note',
      text: 'Owners can retract mistaken memories with an audit reason.',
      actor: owner,
      key: 'eval/retract',
    },
    {
      title: 'Disputed fact note',
      text: 'Agents may mark a disputed fact for human arbitration.',
      actor: chatgpt,
      key: 'eval/disputed',
    },
    {
      title: 'Tesseract OCR note',
      text: 'MEMORY_OS_OCR_ENGINE=tesseract shells out to the system CLI.',
      actor: owner,
      key: 'eval/tesseract',
    },
    {
      title: 'Fixture OCR note',
      text: 'MEMORY_OS_OCR_ENGINE=fixture reads UTF-8 payloads as OCR text.',
      actor: owner,
      key: 'eval/fixture-ocr',
    },
    {
      title: 'Dead letter note',
      text: 'Failed connector jobs eventually move to dead_letter status.',
      actor: owner,
      key: 'eval/dead-letter',
    },
    {
      title: 'RLS matrix note',
      text: 'RLS matrix documents subject visibility rules for Memory OS tables.',
      actor: chatgpt,
      key: 'eval/rls',
    },
    {
      title: 'SECURITY DEFINER note',
      text: 'API RPCs use SECURITY DEFINER with assert_api_secret checks.',
      actor: owner,
      key: 'eval/secdef',
    },
    {
      title: 'Service role policy note',
      text: 'service_role keys must never ship to the browser or Vite env.',
      actor: owner,
      key: 'eval/service-role',
    },
    {
      title: 'Vite AuthPanel note',
      text: 'Web AuthPanel binds Supabase session to subject via /v1/auth/bind.',
      actor: owner,
      key: 'eval/authpanel',
    },
    {
      title: 'Calendar standup stub note',
      text: 'Google Calendar stub invents AISTROYKA standup events from vault refs.',
      actor: chatgpt,
      key: 'eval/cal-standup',
    },
    {
      title: 'Drive brief stub note',
      text: 'Google Drive stub invents Project brief.docx updates without credentials.',
      actor: owner,
      key: 'eval/drive-brief',
    },
    {
      title: 'Gmail pilot stub note',
      text: 'Gmail stub invents pilot inbox metadata threads without bodies.',
      actor: owner,
      key: 'eval/gmail-pilot',
    },
    {
      title: 'API secret note',
      text: 'MEMORY_OS_API_SECRET authenticates public.api_* RPCs server-side only.',
      actor: owner,
      key: 'eval/api-secret',
    },
    {
      title: 'Agentic retrieval budget note',
      text: 'Agentic retrieval budget limits tool loops during context assembly.',
      actor: chatgpt,
      key: 'eval/agentic-budget',
    },
    {
      title: 'Personal compensation confidential',
      text: 'personal compensation bands stay confidential for owner eyes only.',
      actor: owner,
      key: 'eval/personal-comp',
      sensitivity: 'confidential',
    },
  ];

  for (const row of fixtures) {
    store.captureText({
      workspaceId,
      projectId,
      title: row.title,
      text: row.text,
      actorSubjectId: row.actor,
      idempotencyKey: row.key,
      sensitivity: row.sensitivity ?? 'internal',
    });
  }

  expect(fixture.cases.length).toBeGreaterThanOrEqual(80);

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
      if (testCase.expect_no_sensitivity) {
        expect(
          hits.every((h) => h.memory.sensitivity !== testCase.expect_no_sensitivity),
        ).toBe(true);
      }
    });
  }
});

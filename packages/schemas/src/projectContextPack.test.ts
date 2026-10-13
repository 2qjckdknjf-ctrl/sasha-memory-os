import { describe, expect, it } from 'vitest';
import {
  buildProjectContextPack,
  OFFICIAL_M18_PROJECT_CONTEXT_PACK,
} from './projectContextPack';

const projectId = '44444444-4444-4444-8444-444444444402';

function decision(input: {
  id: string;
  title: string;
  content: string;
  recordedAt: string;
  project?: string;
}) {
  return {
    id: input.id,
    title: input.title,
    content: input.content,
    status: 'verified',
    project_id: input.project ?? projectId,
    recorded_at: input.recordedAt,
    source_event_id: `event-${input.id}`,
  };
}

describe('M18.2 project context pack', () => {
  it('packs current goal, milestone, blockers, merges, next work and citations', () => {
    const pack = buildProjectContextPack(
      {
        projectId,
        decisions: [
          decision({
            id: 'm18-1',
            title: 'M18.1 CURSOR BOOTSTRAP LIVE PASS — PR #99',
            content:
              'PR: https://github.com/example/repo/pull/99\nMerge SHA: 1111111111111111111111111111111111111111\n\nKnown external blockers remain: provider consent; Apple device E2E.\n\nNext canonical slice: M18.2_PROJECT_CONTEXT_PACK.',
            recordedAt: '2026-10-13T15:55:32.000Z',
          }),
          decision({
            id: 'canonical-plan',
            title: 'SASHA MEMORY OS — CANONICAL COMPLETION PLAN TO 100%',
            content: 'Canonical plan content.',
            recordedAt: '2026-10-13T12:59:10.000Z',
          }),
        ],
        tasks: [],
        facts: [],
        state: null,
        latestHandoff: {
          id: 'handoff-1',
          projectId,
          fromSubjectId: 'cursor',
          toSubjectId: 'roma',
          createdAt: '2026-10-13T15:59:00.000Z',
          payload: {
            completed: ['implementation complete'],
            validation: ['full gate passed'],
            open_items: ['review deployment receipt'],
            blockers: ['provider consent absent'],
            recommended_next: ['continue from handoff'],
          },
        },
      },
      {
        projectId,
        maxTokens: 1800,
        now: new Date('2026-10-13T16:00:00.000Z'),
      },
    );

    expect(pack.packVersion).toBe('m18-s02-v1');
    expect(pack.currentGoal?.text).toBe('continue from handoff');
    expect(pack.currentMilestone?.id).toBe('m18-1');
    expect(pack.activeBlockers.map((item) => item.text)).toEqual([
      'provider consent absent',
      'review deployment receipt',
      'provider consent',
      'Apple device E2E.',
    ]);
    expect(pack.latestHandoff?.validation[0]?.text).toBe('full gate passed');
    expect(pack.nextWork[0]?.text).toBe('continue from handoff');
    expect(pack.recentMerges[0]).toMatchObject({
      pullRequestUrl: 'https://github.com/example/repo/pull/99',
      mergeSha: '1111111111111111111111111111111111111111',
    });
    expect(pack.sourceFreshness.status).toBe('fresh');
    expect(pack.sourceFreshness.citations).toEqual(['handoff:handoff-1']);
    expect(pack.citations.map((citation) => citation.id)).toContain('memory:m18-1');
    expect(pack.citations.map((citation) => citation.id)).toContain(
      'handoff:handoff-1',
    );
    expect(pack.provenance).toMatchObject({
      source: 'context.project',
      subjectScoped: true,
      explicitProject: true,
    });
    expect(pack.budget.estimatedTokens).toBeLessThanOrEqual(1800);
  });

  it('uses bounded project state as a freshness source when no memories exist', () => {
    const pack = buildProjectContextPack(
      {
        projectId,
        decisions: [],
        tasks: [],
        facts: [],
        state: {
          id: 'state-1',
          project_id: projectId,
          summary: 'state '.repeat(2_000),
          created_at: '2026-10-13T15:59:30.000Z',
        },
      },
      {
        projectId,
        maxTokens: 768,
        now: new Date('2026-10-13T16:00:00.000Z'),
      },
    );

    expect(pack.sourceFreshness).toMatchObject({
      status: 'fresh',
      newestRecordedAt: '2026-10-13T15:59:30.000Z',
      citations: ['project-state:state-1'],
    });
    expect(pack.citations[0]?.title?.length).toBeLessThanOrEqual(220);
    expect(pack.budget.estimatedTokens).toBeLessThanOrEqual(768);
  });

  it('enforces a bounded response and fails closed on cross-project sources', () => {
    const decisions = Array.from({ length: 30 }, (_, index) =>
      decision({
        id: `decision-${index}`,
        title: `M18 decision ${index} ${'title'.repeat(80)}`,
        content: `Long evidence ${'x'.repeat(800)} Next slice: M18.${index}`,
        recordedAt: `2026-10-13T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
      }),
    );
    const pack = buildProjectContextPack(
      { projectId, decisions, tasks: [], facts: [] },
      { projectId, maxTokens: 768, now: new Date('2026-10-13T23:30:00.000Z') },
    );
    expect(pack.budget.maxTokens).toBe(768);
    expect(pack.budget.truncated).toBe(true);
    expect(pack.budget.estimatedTokens).toBeLessThanOrEqual(768);

    expect(() =>
      buildProjectContextPack(
        {
          projectId,
          decisions: [
            decision({
              id: 'leak',
              title: 'Cross project',
              content: 'must fail',
              recordedAt: '2026-10-13T00:00:00.000Z',
              project: '44444444-4444-4444-8444-444444444401',
            }),
          ],
        },
        { projectId },
      ),
    ).toThrow('project context source project mismatch');

    expect(() =>
      buildProjectContextPack(
        {
          projectId,
          decisions: [],
          state: {
            id: 'state-leak',
            project_id: '44444444-4444-4444-8444-444444444401',
          },
        },
        { projectId },
      ),
    ).toThrow('project context state project mismatch');

    expect(() =>
      buildProjectContextPack(
        {
          projectId,
          decisions: [],
          latestHandoff: {
            id: 'handoff-leak',
            projectId: '44444444-4444-4444-8444-444444444401',
            payload: {},
          },
        },
        { projectId },
      ),
    ).toThrow('project context handoff project mismatch');
  });

  it('publishes the seven-tool, explicit-project contract', () => {
    expect(OFFICIAL_M18_PROJECT_CONTEXT_PACK.invariants).toMatchObject({
      explicitProjectRequired: true,
      projectEchoMustMatch: true,
      crossProjectRecordFailsClosed: true,
      citationsRequiredForClaims: true,
      tokenBudgetRequired: true,
      noDefaultProjectFallback: true,
      modeAToolCount: 7,
    });
  });
});

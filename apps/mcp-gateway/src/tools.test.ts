import { describe, expect, it, vi } from 'vitest';
import { createSeededStore } from '@memory-os/domain';
import {
  SEARCH_RANKING_VERSION,
  SEARCH_RANKING_WEIGHTS_VERSION,
} from '@memory-os/retrieval';
import { createMcpHandlers } from './tools.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const owner = '33333333-3333-4333-8333-333333333301';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const cursor = '33333333-3333-4333-8333-333333333303';
const roma = '33333333-3333-4333-8333-333333333304';
const otherProjectId = '44444444-4444-4444-8444-444444444430';
const coreProjectId = '44444444-4444-4444-8444-444444444431';
const osProjectId = '44444444-4444-4444-8444-444444444432';

function createTwoProjectGateway() {
  return {
    listProjects: vi.fn(async () => [
      {
        id: projectId,
        slug: 'aistroyka',
        name: 'AISTROYKA',
        status: 'active',
        url: 'https://github.com/aistroyka/core',
      },
    ]),
    listProjectHints: vi.fn(async () => [
      {
        id: projectId,
        slug: 'aistroyka',
        name: 'AISTROYKA',
        status: 'active',
        url: 'https://github.com/aistroyka/core',
      },
      {
        id: otherProjectId,
        slug: 'repo-b',
        name: 'Repo B',
        status: 'active',
        url: 'https://github.com/team/repo-b',
      },
    ]),
    resolveProjectRef: vi.fn(async ({ projectRef }: { projectRef?: string | null }) => {
      if (projectRef === 'repo-b' || projectRef === otherProjectId) {
        return {
          projectId: otherProjectId,
          matchCount: 1,
          candidates: [
            {
              id: otherProjectId,
              slug: 'repo-b',
              name: 'Repo B',
              url: 'https://github.com/team/repo-b',
            },
          ],
        };
      }
      if (projectRef === 'aistroyka' || projectRef === projectId) {
        return {
          projectId,
          matchCount: 1,
          candidates: [
            {
              id: projectId,
              slug: 'aistroyka',
              name: 'AISTROYKA',
              url: 'https://github.com/aistroyka/core',
            },
          ],
        };
      }
      return { projectId: null, matchCount: 0, candidates: [] };
    }),
    captureText: vi.fn(async () => ({ process: null })),
    createDecision: vi.fn(async () => ({ id: 'decision-1' })),
    createHandoff: vi.fn(async () => ({ id: 'handoff-1' })),
    search: vi.fn(async () => []),
    appendAuditEvent: vi.fn(async () => ({})),
  };
}

function createShortTokenGateway() {
  return {
    listProjectHints: vi.fn(async () => [
      {
        id: coreProjectId,
        slug: 'core',
        name: 'core',
        status: 'active',
        url: 'https://github.com/team/core',
      },
      {
        id: osProjectId,
        slug: 'os',
        name: 'os',
        status: 'active',
        url: 'https://github.com/team/os',
      },
      {
        id: projectId,
        slug: 'aistroyka',
        name: 'AISTROYKA',
        status: 'active',
        url: 'https://github.com/aistroyka/core',
      },
    ]),
    resolveProjectRef: vi.fn(async ({ projectRef }: { projectRef?: string | null }) => {
      if (projectRef === coreProjectId || projectRef === 'core') {
        return {
          projectId: coreProjectId,
          matchCount: 1,
          candidates: [
            {
              id: coreProjectId,
              slug: 'core',
              name: 'core',
              url: 'https://github.com/team/core',
            },
          ],
        };
      }
      if (projectRef === osProjectId || projectRef === 'os') {
        return {
          projectId: osProjectId,
          matchCount: 1,
          candidates: [
            {
              id: osProjectId,
              slug: 'os',
              name: 'os',
              url: 'https://github.com/team/os',
            },
          ],
        };
      }
      if (projectRef === projectId || projectRef === 'aistroyka' || projectRef === 'AISTROYKA') {
        return {
          projectId,
          matchCount: 1,
          candidates: [
            {
              id: projectId,
              slug: 'aistroyka',
              name: 'AISTROYKA',
              url: 'https://github.com/aistroyka/core',
            },
          ],
        };
      }
      return { projectId: null, matchCount: 0, candidates: [] };
    }),
    createDecision: vi.fn(async () => ({ id: 'decision-short-token' })),
    captureText: vi.fn(async () => ({ process: null })),
  };
}

describe('mcp gateway alpha', () => {
  it('lists core tools', () => {
    const mcp = createMcpHandlers();
    expect(mcp.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'memory.search',
        'context.project',
        'memory.store_decision',
        'handoff.create',
        'connections.list',
        'connections.upsert',
        'connections.set_status',
        'capture.text',
        'connections.sync',
        'oauth.start',
        'oauth.callback',
        'outbox.list_pending',
        'jobs.dead_letter_stale',
        'outbox.publish',
        'capture.document',
        'capture.link',
        'consolidation.run',
        'memory.set_status',
        'memory.get',
        'memory.embed',
        'memory.embed_missing',
        'memory.export',
        'jobs.get',
        'extraction.preview',
        'extraction.apply',
        'extraction.run',
      ]),
    );
  });

  it('previews extraction offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('extraction.preview', {
      title: 'Note',
      text: 'Vault refs stay out of Postgres.',
      actor_subject_id: cursor,
    })) as { preview: boolean; candidates: unknown[] };
    expect(result.preview).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('applies extraction candidates offline', async () => {
    const mcp = createMcpHandlers();
    const owner = '33333333-3333-4333-8333-333333333301';
    const result = (await mcp.call('extraction.apply', {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: owner,
      idempotency_prefix: 'mcp-extract-apply-1',
      candidates: [
        {
          title: 'Vault rule',
          content: 'Vault refs stay out of Postgres.',
          memoryType: 'fact',
          confidence: 0.8,
        },
      ],
    })) as { applied: number; failed: number };
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('rejects extraction.apply without project_id', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('extraction.apply', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        idempotency_prefix: 'mcp-extract-apply-no-project-1',
        candidates: [
          {
            title: 'No project',
            content: 'This should not write anywhere.',
            memoryType: 'fact',
            confidence: 0.8,
          },
        ],
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('routes extraction.apply to an explicit project UUID', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('extraction.apply', {
      workspace_id: workspaceId,
      project_id: otherProjectId,
      actor_subject_id: cursor,
      idempotency_prefix: 'mcp-extract-apply-explicit-1',
      candidates: [
        {
          title: 'Repo B extract',
          content: 'Write this to repo-b explicitly.',
          memoryType: 'fact',
          confidence: 0.8,
        },
      ],
    });
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('searches with RRF and packed context offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('memory.search', {
      query: 'Slice 01',
      project_id: projectId,
      actor_subject_id: cursor,
      pack_context: true,
      max_context_chars: 1500,
    })) as {
      ranking: string;
      rankingVersion: string;
      rankingWeightsVersion: string;
      hits: Array<{ reason?: string }>;
      context?: { packedCount: number; text: string };
    };
    expect(result.ranking).toBe('hybrid-rrf');
    expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
    expect(result.rankingWeightsVersion).toBe(SEARCH_RANKING_WEIGHTS_VERSION);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.reason).toBe('hybrid:rrf');
    expect(result.context?.packedCount).toBeGreaterThan(0);
    expect(result.context?.text).toContain('[1]');
  });

  it('requires explicit project_id for bounded agentic memory.search instead of inferring AISTROYKA', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });

    await expect(
      mcp.call('memory.search', {
        query: 'AISTROYKA release plan',
        actor_subject_id: cursor,
        retrieval_mode: 'agentic',
      }),
    ).rejects.toThrow(
      /project_id is required for bounded agentic retrieval; never default to AISTROYKA/i,
    );
    expect(gateway.search).not.toHaveBeenCalled();
  });

  it('traces bounded agentic memory.search without widening scope or writing', async () => {
    const gateway = {
      resolveProjectRef: vi.fn(async ({ projectRef }: { projectRef?: string | null }) => {
        if (projectRef === projectId || projectRef === 'aistroyka') {
          return {
            projectId,
            matchCount: 1,
            candidates: [
              {
                id: projectId,
                slug: 'aistroyka',
                name: 'AISTROYKA',
                url: 'https://github.com/aistroyka/core',
              },
            ],
          };
        }
        return { projectId: null, matchCount: 0, candidates: [] };
      }),
      search: vi.fn(async () => [
        {
          memory: {
            id: 'scoped-hit',
            projectId,
            title: 'Scoped memory',
            content: 'Belongs to the requested project.',
            status: 'verified',
          },
          score: 0.91,
          reason: 'structured+text',
        },
        {
          memory: {
            id: 'scoped-leak',
            projectId: otherProjectId,
            title: 'Leaked memory',
            content: 'Must be filtered from the explicit scope.',
            status: 'active',
          },
          score: 0.99,
          reason: 'structured+text',
        },
      ]),
      appendAuditEvent: vi.fn(async () => ({})),
      createDecision: vi.fn(async () => ({ id: 'decision-should-not-run' })),
      captureText: vi.fn(async () => ({ process: null })),
    };
    const mcp = createMcpHandlers({ gateway: gateway as any });

    const result = (await mcp.call('memory.search', {
      query: 'Scoped memory',
      project_id: projectId,
      actor_subject_id: cursor,
      retrieval_mode: 'agentic',
      agentic: {
        max_steps: 2,
        min_evidence_hits: 1,
      },
    })) as {
      rankingVersion: string;
      rankingWeightsVersion: string;
      hits: Array<{ memory: { projectId?: string | null } }>;
      agentic: {
        rankingWeightsVersion: string;
        toolAllowlist: string[];
        writeActionsAttempted: number;
        trace: {
          steps: Array<{
            scopeFilteredCount: number;
            hop?: { kind?: string } | null;
          }>;
        };
      };
    };

    expect(result.hits).toHaveLength(1);
    expect(result.rankingVersion).toBe(SEARCH_RANKING_VERSION);
    expect(result.rankingWeightsVersion).toBe(SEARCH_RANKING_WEIGHTS_VERSION);
    expect(result.agentic.rankingWeightsVersion).toBe(SEARCH_RANKING_WEIGHTS_VERSION);
    expect(result.hits[0]?.memory.projectId).toBe(projectId);
    expect(result.agentic.toolAllowlist).toEqual(['memory.search']);
    expect(result.agentic.writeActionsAttempted).toBe(0);
    expect(result.agentic.trace.steps[0]?.scopeFilteredCount).toBe(1);
    expect(
      result.agentic.trace.steps.some((step) => step.hop?.kind === 'related_evidence'),
    ).toBe(true);
    expect(gateway.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retrieval.agentic_search.completed',
        afterState: expect.objectContaining({
          mode: 'agentic',
          projectId,
          writeActionsAttempted: 0,
        }),
      }),
    );
    expect(gateway.createDecision).not.toHaveBeenCalled();
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('default-denies personal Gmail and Calendar memories for Cursor, ROMA, and ChatGPT offline', async () => {
    const store = createSeededStore();
    const ownerMcp = createMcpHandlers({ store });
    const chatgptMcp = createMcpHandlers({ store, profile: 'chatgpt' });

    const gmailCapture = (await ownerMcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Personal Gmail connector memory',
      text: 'Personal Gmail connector memory about family travel must stay private.',
      actor_subject_id: owner,
      idempotency_key: 'mcp-personal-gmail-1',
      sensitivity: 'personal',
    })) as { memoryId: string };
    await ownerMcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Personal Calendar connector memory',
      text: 'Personal Calendar connector memory about a doctor appointment must stay private.',
      actor_subject_id: owner,
      idempotency_key: 'mcp-personal-calendar-1',
      sensitivity: 'personal',
    });

    const ownerSearch = (await ownerMcp.call('memory.search', {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: owner,
      query: 'personal connector memory',
    })) as { hits: Array<{ memory: { title: string } }> };
    expect(
      ownerSearch.hits.some((hit) => hit.memory.title === 'Personal Gmail connector memory'),
    ).toBe(true);
    expect(
      ownerSearch.hits.some((hit) => hit.memory.title === 'Personal Calendar connector memory'),
    ).toBe(true);

    for (const subjectId of [cursor, roma]) {
      const deniedSearch = (await ownerMcp.call('memory.search', {
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: subjectId,
        query: 'personal connector memory',
      })) as { hits: Array<{ memory: { title: string } }> };
      expect(deniedSearch.hits).toEqual([]);
      await expect(
        ownerMcp.call('memory.get', {
          workspace_id: workspaceId,
          actor_subject_id: subjectId,
          memory_id: gmailCapture.memoryId,
        }),
      ).rejects.toThrow(/forbidden/i);
    }

    const deniedChatgptSearch = (await chatgptMcp.call('memory.search', {
      project_id: projectId,
      query: 'personal connector memory',
    })) as { hits: Array<{ memory: { title: string } }> };
    expect(deniedChatgptSearch.hits).toEqual([]);
    await expect(
      chatgptMcp.call('memory.get', {
        memory_id: gmailCapture.memoryId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it('keeps personal memories out of offline project context for agents but not owner', async () => {
    const store = createSeededStore();
    const ownerMcp = createMcpHandlers({ store });
    const chatgptMcp = createMcpHandlers({ store, profile: 'chatgpt' });

    await ownerMcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Personal Calendar standup note',
      text: 'Personal Calendar standup note should stay owner-visible only.',
      actor_subject_id: owner,
      idempotency_key: 'mcp-personal-context-1',
      sensitivity: 'personal',
    });

    const ownerContext = (await ownerMcp.call('context.project', {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: owner,
    })) as { facts: Array<{ title: string }> };
    expect(
      ownerContext.facts.some((memory) => memory.title === 'Personal Calendar standup note'),
    ).toBe(true);

    for (const subjectId of [cursor, roma]) {
      const context = (await ownerMcp.call('context.project', {
        workspace_id: workspaceId,
        project_id: projectId,
        actor_subject_id: subjectId,
      })) as { facts: Array<{ title: string }> };
      expect(
        context.facts.some((memory) => memory.title === 'Personal Calendar standup note'),
      ).toBe(false);
    }

    const chatgptContext = (await chatgptMcp.call('context.project', {
      project_id: projectId,
    })) as { facts: Array<{ title: string }> };
    expect(
      chatgptContext.facts.some((memory) => memory.title === 'Personal Calendar standup note'),
    ).toBe(false);
  });

  it('runs extract+apply offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('extraction.run', {
      title: 'Run',
      text: 'Selected scopes for Drive sync.',
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: owner,
      apply: true,
      idempotency_prefix: 'mcp-extract-run-1',
    })) as {
      applied: boolean;
      candidates: unknown[];
      apply?: { applied: number };
    };
    expect(result.applied).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.apply?.applied).toBeGreaterThan(0);
  });

  it('returns extraction.run preview without project_id when apply=false', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('extraction.run', {
      title: 'Preview only',
      text: 'Preview this without persisting anything.',
      actor_subject_id: cursor,
      apply: false,
    })) as { preview: boolean; applied: boolean; candidates: unknown[] };
    expect(result.preview).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('rejects extraction.run with apply=true when project_id is omitted', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('extraction.run', {
        title: 'Apply without project',
        text: 'This should fail before writing.',
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        apply: true,
        idempotency_prefix: 'mcp-extract-run-no-project-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('exports memories for owner offline', async () => {
    const mcp = createMcpHandlers();
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Export via MCP',
      text: 'portable dump from mcp tool',
      actor_subject_id: owner,
      idempotency_key: 'mcp-export-1',
      process_now: true,
    });
    const dump = (await mcp.call('memory.export', {
      workspace_id: workspaceId,
      actor_subject_id: owner,
      limit: 50,
    })) as { format: string; count: number };
    expect(dump.format).toBe('memory-os.export.memories.v1');
    expect(dump.count).toBeGreaterThan(0);
  });

  it('returns stub job status offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('jobs.get', {
      job_id: '00000000-0000-4000-8000-000000000099',
      actor_subject_id: cursor,
    })) as { status: string; backend?: string };
    expect(result.status).toBe('succeeded');
    expect(result.backend).toBe('memory-store');
  });

  it('lists empty outbox offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('outbox.list_pending', {
      workspace_id: workspaceId,
      actor_subject_id: owner,
    })) as { count: number; backend?: string };
    expect(result.count).toBe(0);
    expect(result.backend).toBe('memory-store');
  });

  it('starts oauth stub offline', async () => {
    const mcp = createMcpHandlers();
    const started = (await mcp.call('oauth.start', {
      workspace_id: workspaceId,
      connector_id: 'github',
      display_name: 'MCP OAuth',
      actor_subject_id: owner,
      scopes: ['repositories.read'],
    })) as { authorizeUrl: string; state: string; backend?: string };
    expect(started.backend).toBe('memory-store');
    expect(started.authorizeUrl).toContain('stub://oauth/github');
    const done = (await mcp.call('oauth.callback', {
      state: started.state,
      code: 'mcp-code',
      actor_subject_id: owner,
    })) as { exchangeMode: string; tokenPersisted: boolean };
    expect(done.exchangeMode).toBe('stub');
    expect(done.tokenPersisted).toBe(false);
  });

  it('runs offline consolidation for duplicate titles', async () => {
    const mcp = createMcpHandlers();
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Dup Note',
      text: 'first',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-dup-1',
    });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'dup note',
      text: 'second',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-dup-2',
    });
    const report = (await mcp.call('consolidation.run', {
      workspace_id: workspaceId,
      actor_subject_id: owner,
      apply: true,
    })) as { planned: number; applied: unknown[] };
    expect(report.planned).toBeGreaterThanOrEqual(1);
    expect(report.applied.length).toBeGreaterThanOrEqual(1);
  });

  it('requires explicit project_id for proactive consolidation instead of defaulting to AISTROYKA', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });

    await expect(
      mcp.call('consolidation.run', {
        workspace_id: workspaceId,
        actor_subject_id: owner,
        proactive: true,
        apply: true,
      }),
    ).rejects.toThrow(
      /project_id is required for proactive consolidation; never default to AISTROYKA/i,
    );
    expect(gateway.resolveProjectRef).not.toHaveBeenCalled();
  });

  it('keeps proactive consolidation scoped to one explicit project and audits the run offline', async () => {
    const mcp = createMcpHandlers();
    await mcp.call('memory.store_decision', {
      workspace_id: workspaceId,
      project_id: projectId,
      actor_subject_id: owner,
      title: 'API base URL',
      content: 'Use https://api.example.com.',
      idempotency_key: 'mcp-proactive-decision-1',
    });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Scoped duplicate',
      text: 'first scoped copy',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-proactive-dup-1',
    });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'scoped duplicate',
      text: 'second scoped copy',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-proactive-dup-2',
    });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'api base url',
      text: 'Use https://staging.example.com until cutover.',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-proactive-conflict-1',
    });
    const report = (await mcp.call('consolidation.run', {
      workspace_id: workspaceId,
      actor_subject_id: owner,
      project_id: projectId,
      proactive: true,
      apply: true,
    })) as {
      projectId: string;
      planned: number;
      applied: unknown[];
      verifiedWrites: number;
      auditEventId: string;
      detectedConflicts: Array<{ reason: string; memoryIds: string[] }>;
      persistedConflictIds: string[];
    };

    expect(report.projectId).toBe(projectId);
    expect(report.planned).toBeGreaterThanOrEqual(1);
    expect(report.applied.length).toBeGreaterThanOrEqual(1);
    expect(report.verifiedWrites).toBe(0);
    expect(report.auditEventId).toBeTruthy();
    expect(
      report.detectedConflicts.some(
        (conflict) => conflict.reason === 'same-title-divergent-content',
      ),
    ).toBe(true);
    expect(report.persistedConflictIds.length).toBeGreaterThanOrEqual(1);
  });

  it('sets memory status offline', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const captured = (await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'Review me',
      text: 'Candidate for status change',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-status-1',
    })) as { memoryId: string };
    const updated = (await mcp.call('memory.set_status', {
      memory_id: captured.memoryId,
      status: 'verified',
      reason: 'Looks good',
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
    })) as { status: string };
    expect(updated.status).toBe('verified');
  });

  it('captures document offline via base64 text', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const result = (await mcp.call('capture.document', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'MCP doc',
      filename: 'note.txt',
      mime_type: 'text/plain',
      content_base64: Buffer.from('Document via MCP').toString('base64'),
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-doc-1',
    })) as { memoryId: string; extractedChars?: number };
    expect(result.memoryId).toBeTruthy();
    expect(result.extractedChars).toBeGreaterThan(0);
  });

  it('rejects capture.document without project_id', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('capture.document', {
        workspace_id: workspaceId,
        title: 'MCP doc',
        filename: 'note.txt',
        mime_type: 'text/plain',
        content_base64: Buffer.from('Document via MCP').toString('base64'),
        actor_subject_id: cursor,
        idempotency_key: 'mcp-doc-no-project-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('routes capture.document to an explicit project UUID', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('capture.document', {
      workspace_id: workspaceId,
      project_id: otherProjectId,
      title: 'Repo B doc',
      filename: 'note.txt',
      mime_type: 'text/plain',
      content_base64: Buffer.from('Document via MCP').toString('base64'),
      actor_subject_id: cursor,
      idempotency_key: 'mcp-doc-explicit-project-1',
    });
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('rejects capture.link without project_id', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('capture.link', {
        workspace_id: workspaceId,
        url: 'https://example.com/note',
        title: 'Link without project',
        actor_subject_id: cursor,
        idempotency_key: 'mcp-link-no-project-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('routes capture.link to an explicit project UUID', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'text/plain' }),
      arrayBuffer: async () => Buffer.from('Public link body'),
      url: 'https://example.com/note',
    })) as typeof fetch;
    try {
      await mcp.call('capture.link', {
        workspace_id: workspaceId,
        project_id: otherProjectId,
        url: 'https://example.com/note',
        title: 'Repo B link',
        actor_subject_id: cursor,
        idempotency_key: 'mcp-link-explicit-project-1',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('returns offline stub for connections.sync', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('connections.sync', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
    })) as { count: number; backend?: string };
    expect(result.count).toBe(0);
    expect(result.backend).toBe('memory-store');
  });

  it('captures text offline into candidate memory', async () => {
    const mcp = createMcpHandlers();
    const chatgpt = '33333333-3333-4333-8333-333333333302';
    const result = (await mcp.call('capture.text', {
      workspace_id: workspaceId,
      project_id: projectId,
      title: 'MCP capture',
      text: 'Captured via MCP tool',
      actor_subject_id: chatgpt,
      idempotency_key: 'mcp-capture-1',
    })) as { memoryId: string };
    expect(result.memoryId).toBeTruthy();
  });

  it('rejects omitted ChatGPT project_id when no project can be inferred', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    await expect(
      mcp.call('capture.text', {
        title: 'Workspace capture',
        text: 'No explicit project id here.',
        idempotency_key: 'mcp-chatgpt-workspace-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
  });

  it('routes ChatGPT capture to AISTROYKA when slug is mentioned', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    const captured = (await mcp.call('capture.text', {
      title: 'aistroyka follow-up',
      text: 'Note about aistroyka backlog',
      idempotency_key: 'mcp-chatgpt-aistroyka-1',
    })) as { memoryId: string };
    const memory = (await mcp.call('memory.get', {
      memory_id: captured.memoryId,
    })) as { memory?: { projectId?: string | null } };
    expect(memory.memory?.projectId).toBe(projectId);
  });

  it('routes Cursor capture to a non-AISTROYKA ingested project by slug', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      title: 'repo-b note',
      text: 'Cursor mentioned repo-b explicitly.',
      actor_subject_id: cursor,
      idempotency_key: 'mcp-cursor-repo-b-1',
    });
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('routes both ChatGPT and Cursor writes 1:1 across two named projects', async () => {
    const gateway = createTwoProjectGateway();
    const chatgptMcp = createMcpHandlers({ gateway: gateway as any, profile: 'chatgpt' });
    const cursorMcp = createMcpHandlers({ gateway: gateway as any });

    await chatgptMcp.call('capture.text', {
      title: 'aistroyka note',
      text: 'ChatGPT talked about aistroyka',
      idempotency_key: 'mcp-chatgpt-aistroyka-2',
    });
    await chatgptMcp.call('capture.text', {
      title: 'repo-b note',
      text: 'ChatGPT talked about repo-b',
      idempotency_key: 'mcp-chatgpt-repo-b-2',
    });
    await cursorMcp.call('capture.text', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      title: 'aistroyka task',
      text: 'Cursor worked on aistroyka',
      idempotency_key: 'mcp-cursor-aistroyka-2',
    });
    await cursorMcp.call('capture.text', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      title: 'repo-b task',
      text: 'Cursor worked on repo-b',
      idempotency_key: 'mcp-cursor-repo-b-2',
    });

    const resolvedProjectIds = gateway.captureText.mock.calls.map(
      ([input]: [{ projectId?: string | null }]) => input.projectId ?? null,
    );
    expect(resolvedProjectIds).toEqual([
      projectId,
      otherProjectId,
      projectId,
      otherProjectId,
    ]);
  });

  it('rejects capture.text without a project hint instead of writing to workspace scope', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('capture.text', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        title: 'General note',
        text: 'No project name here.',
        idempotency_key: 'mcp-cursor-workspace-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('routes ChatGPT handoff.create to an ingested project by shared name', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any, profile: 'chatgpt' });
    await mcp.call('handoff.create', {
      workspace_id: workspaceId,
      from_subject_id: '33333333-3333-4333-8333-333333333302',
      idempotency_key: 'mcp-chatgpt-handoff-repo-b-1',
      payload: {
        completed: ['routed handoff'],
        artifacts: [],
        validation: [],
        open_items: ['repo-b'],
        blockers: [],
        recommended_next: ['continue repo-b'],
      },
    });
    expect(gateway.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('routes memory.store_decision to an ingested project by slug', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('memory.store_decision', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      title: 'repo-b decision',
      content: 'Choose repo-b rollout order.',
      idempotency_key: 'mcp-decision-repo-b-1',
      importance: 0.7,
      confidence: 0.9,
      sensitivity: 'internal',
    });
    expect(gateway.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('prefers an explicit project_id even when the body mentions another catalog project', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('memory.store_decision', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      project_id: projectId,
      title: 'AISTROYKA decision',
      content: 'AISTROYKA owns this, but gmail-style repo-b is mentioned in the note.',
      idempotency_key: 'mcp-decision-explicit-wins-1',
      importance: 0.7,
      confidence: 0.9,
      sensitivity: 'internal',
    });
    expect(gateway.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId }),
    );
  });

  it('rejects an explicit UUID when that project does not exist', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('memory.store_decision', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        project_id: '44444444-4444-4444-8444-444444444499',
        title: 'Unknown project',
        content: 'No textual fallback should override this explicit id.',
        idempotency_key: 'mcp-decision-explicit-missing-1',
        importance: 0.7,
        confidence: 0.9,
        sensitivity: 'internal',
      }),
    ).rejects.toThrow(/project not found/i);
    expect(gateway.createDecision).not.toHaveBeenCalled();
  });

  it('does not infer short/common project tokens from ordinary prose', async () => {
    const gateway = createShortTokenGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('memory.store_decision', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        title: 'General note',
        content: 'the core idea of Memory OS',
        idempotency_key: 'mcp-decision-short-token-1',
        importance: 0.7,
        confidence: 0.9,
        sensitivity: 'internal',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.createDecision).not.toHaveBeenCalled();
  });

  it('still resolves an explicit project UUID without any text hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('memory.store_decision', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      project_id: otherProjectId,
      title: 'General note',
      content: 'No textual project reference is needed here.',
      idempotency_key: 'mcp-decision-explicit-uuid-1',
      importance: 0.7,
      confidence: 0.9,
      sensitivity: 'internal',
    });
    expect(gateway.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('rejects ChatGPT memory.store_decision without project_id', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any, profile: 'chatgpt' });
    await expect(
      mcp.call('memory.store_decision', {
        title: 'ChatGPT decision',
        content: 'No project id is present here.',
        idempotency_key: 'mcp-chatgpt-decision-no-project-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.createDecision).not.toHaveBeenCalled();
  });

  it('accepts ChatGPT memory.store_decision with the seed UUID', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any, profile: 'chatgpt' });
    await mcp.call('memory.store_decision', {
      project_id: projectId,
      title: 'ChatGPT decision',
      content: 'Seed project is explicit here.',
      idempotency_key: 'mcp-chatgpt-decision-seed-1',
    });
    expect(gateway.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId }),
    );
  });

  it('still resolves an explicit short slug without any text hint', async () => {
    const gateway = createShortTokenGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('memory.store_decision', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      project_id: 'core',
      title: 'General note',
      content: 'No textual project reference is needed here.',
      idempotency_key: 'mcp-decision-explicit-core-1',
      importance: 0.7,
      confidence: 0.9,
      sensitivity: 'internal',
    });
    expect(gateway.createDecision).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: coreProjectId }),
    );
  });

  it('rejects memory.store_decision without a project hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('memory.store_decision', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        title: 'General decision',
        content: 'No project is referenced here.',
        idempotency_key: 'mcp-decision-no-project-1',
        importance: 0.7,
        confidence: 0.9,
        sensitivity: 'internal',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.createDecision).not.toHaveBeenCalled();
  });

  it('rejects handoff.create without a project hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('handoff.create', {
        workspace_id: workspaceId,
        from_subject_id: cursor,
        to_subject_id: cursor,
        idempotency_key: 'mcp-handoff-no-project-1',
        payload: {
          completed: ['done'],
          artifacts: [],
          validation: [],
          open_items: [],
          blockers: [],
          recommended_next: ['continue'],
        },
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.createHandoff).not.toHaveBeenCalled();
  });

  it('routes capture.text to an ingested project by URL hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      title: 'General note',
      text: 'Source: https://github.com/team/repo-b',
      idempotency_key: 'mcp-cursor-url-project-1',
    });
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('routes capture.text to an ingested project by owner/repo hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('capture.text', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      title: 'Repo token note',
      text: 'Owner/repo hint: team/repo-b',
      idempotency_key: 'mcp-cursor-owner-repo-1',
    });
    expect(gateway.captureText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: otherProjectId }),
    );
  });

  it('does not treat arbitrary path-like slash tokens as project refs', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await expect(
      mcp.call('capture.text', {
        workspace_id: workspaceId,
        actor_subject_id: cursor,
        title: 'Path token note',
        text: 'Touched apps/web and src/index today.',
        idempotency_key: 'mcp-cursor-path-token-1',
      }),
    ).rejects.toThrow(/project reference is required/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('keeps memory.search workspace-wide when there is no project hint', async () => {
    const gateway = createTwoProjectGateway();
    const mcp = createMcpHandlers({ gateway: gateway as any });
    await mcp.call('memory.search', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
      query: 'general note without project hint',
    });
    expect(gateway.search).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: undefined }),
    );
  });

  it('errors on ambiguous project refs instead of defaulting to AISTROYKA', async () => {
    const gateway = {
      listProjects: vi.fn(async () => [
        {
          id: projectId,
          slug: 'aistroyka',
          name: 'AISTROYKA',
          status: 'active',
          url: 'https://github.com/aistroyka/core',
        },
      ]),
      listProjectHints: vi.fn(async () => [
        {
          id: projectId,
          slug: 'aistroyka',
          name: 'AISTROYKA',
          status: 'active',
          url: 'https://github.com/aistroyka/core',
        },
      ]),
      resolveProjectRef: vi.fn(async () => ({
        projectId: null,
        matchCount: 2,
        candidates: [
          {
            id: projectId,
            slug: 'aistroyka',
            name: 'AISTROYKA',
            url: 'https://github.com/aistroyka/core',
          },
          {
            id: '44444444-4444-4444-8444-444444444430',
            slug: 'repo-b',
            name: 'Repo B',
            url: 'https://github.com/team/repo-b',
          },
        ],
      })),
      captureText: vi.fn(async () => ({ process: null })),
    };
    const mcp = createMcpHandlers({ gateway: gateway as any, profile: 'chatgpt' });
    await expect(
      mcp.call('capture.text', {
        workspace_id: workspaceId,
        project_id: 'shared-ref',
        title: 'Shared ref',
        text: 'This ref is ambiguous.',
        idempotency_key: 'mcp-chatgpt-ambiguous-1',
      }),
    ).rejects.toThrow(/ambiguous/i);
    expect(gateway.captureText).not.toHaveBeenCalled();
  });

  it('returns project context with seeded decision', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('context.project', {
      project_id: projectId,
      actor_subject_id: cursor,
    })) as { decisions: unknown[]; state: { version: number } | null };
    expect(result.decisions.length).toBe(1);
    expect(result.state?.version).toBe(1);
  });

  it('accepts context.project by slug', async () => {
    const mcp = createMcpHandlers({ profile: 'chatgpt' });
    const result = (await mcp.call('context.project', {
      project_id: 'aistroyka',
    })) as { decisions: unknown[] };
    expect(result.decisions.length).toBe(1);
  });

  it('lists connections stub offline', async () => {
    const mcp = createMcpHandlers();
    const result = (await mcp.call('connections.list', {
      workspace_id: workspaceId,
      actor_subject_id: cursor,
    })) as { connections: unknown[] };
    expect(result.connections.length).toBeGreaterThan(0);
  });


  it('creates handoff tool result', async () => {
    const mcp = createMcpHandlers();
    const handoff = await mcp.call('handoff.create', {
      workspace_id: workspaceId,
      project_id: projectId,
      from_subject_id: cursor,
      idempotency_key: 'mcp-handoff-1',
      payload: {
        completed: ['context loaded'],
        artifacts: [],
        validation: [],
        open_items: [],
        blockers: [],
        recommended_next: ['ship WP-02'],
      },
    });
    expect((handoff as { projectId: string }).projectId).toBe(projectId);
  });
});

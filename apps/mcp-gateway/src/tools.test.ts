import { describe, expect, it, vi } from 'vitest';
import { createMcpHandlers } from './tools.js';

const projectId = '44444444-4444-4444-8444-444444444401';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const cursor = '33333333-3333-4333-8333-333333333303';
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

  it('searches with RRF and packed context offline', async () => {
    const mcp = createMcpHandlers();
    const cursor = '33333333-3333-4333-8333-333333333303';
    const result = (await mcp.call('memory.search', {
      query: 'Slice 01',
      project_id: projectId,
      actor_subject_id: cursor,
      pack_context: true,
      max_context_chars: 1500,
    })) as {
      ranking: string;
      hits: Array<{ reason?: string }>;
      context?: { packedCount: number; text: string };
    };
    expect(result.ranking).toBe('hybrid-rrf');
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.reason).toBe('hybrid:rrf');
    expect(result.context?.packedCount).toBeGreaterThan(0);
    expect(result.context?.text).toContain('[1]');
  });

  it('runs extract+apply offline', async () => {
    const mcp = createMcpHandlers();
    const owner = '33333333-3333-4333-8333-333333333301';
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

  it('exports memories for owner offline', async () => {
    const mcp = createMcpHandlers();
    const owner = '33333333-3333-4333-8333-333333333301';
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
    const owner = '33333333-3333-4333-8333-333333333301';
    const result = (await mcp.call('outbox.list_pending', {
      workspace_id: workspaceId,
      actor_subject_id: owner,
    })) as { count: number; backend?: string };
    expect(result.count).toBe(0);
    expect(result.backend).toBe('memory-store');
  });

  it('starts oauth stub offline', async () => {
    const mcp = createMcpHandlers();
    const owner = '33333333-3333-4333-8333-333333333301';
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
    const owner = '33333333-3333-4333-8333-333333333301';
    const chatgpt = '33333333-3333-4333-8333-333333333302';
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

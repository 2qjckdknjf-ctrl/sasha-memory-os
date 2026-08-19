import { describe, expect, it } from 'vitest';
import {
  buildHandoffsPath,
  buildMemoriesPath,
  buildSearchRequest,
  requireExplicitProjectId,
  resolveWriteProjectId,
  shouldLoadProjectScopedContext,
} from './projectScope';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const seedProjectId = '44444444-4444-4444-8444-444444444401';
const otherProjectId = '44444444-4444-4444-8444-444444444420';

describe('project scope helpers', () => {
  it('builds workspace-wide review and task fetches without the seed project id', () => {
    const reviewPath = buildMemoriesPath({
      workspaceId,
      projectId: null,
      status: 'candidate',
      limit: 50,
    });
    const taskPath = buildMemoriesPath({
      workspaceId,
      projectId: null,
      limit: 100,
    });

    expect(reviewPath).toContain(`workspace_id=${workspaceId}`);
    expect(reviewPath).not.toContain('project_id=');
    expect(reviewPath).not.toContain(seedProjectId);
    expect(taskPath).not.toContain('project_id=');
    expect(taskPath).not.toContain(seedProjectId);
  });

  it('builds workspace-wide handoff fetches without the seed project id', () => {
    const path = buildHandoffsPath({
      workspaceId,
      projectId: null,
      limit: 50,
    });

    expect(path).toContain(`workspace_id=${workspaceId}`);
    expect(path).not.toContain('project_id=');
    expect(path).not.toContain(seedProjectId);
  });

  it('omits project_id from workspace-wide search requests', () => {
    const body = buildSearchRequest({
      query: 'Slice 01',
      projectId: null,
      packContext: true,
      maxContextChars: 3_000,
    });

    expect(body).not.toHaveProperty('project_id');
  });

  it('rejects writes without an explicit project instead of falling back to AISTROYKA', () => {
    expect(() => requireExplicitProjectId(null)).toThrow(/never default to AISTROYKA/i);
  });

  it('uses the current /projects/:id route as the write target', () => {
    expect(
      resolveWriteProjectId({
        routeProjectId: otherProjectId,
        selectedProjectId: seedProjectId,
      }),
    ).toBe(otherProjectId);
  });

  it('skips project-context loading when no single project is selected', () => {
    expect(shouldLoadProjectScopedContext(null)).toBe(false);
    expect(shouldLoadProjectScopedContext(otherProjectId)).toBe(true);
  });
});

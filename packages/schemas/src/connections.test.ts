import { describe, expect, it } from 'vitest';
import {
  connectionMetadataSchema,
  githubAppConnectionMetadata,
  githubAppInstallationId,
  githubAppReconcileRequestSchema,
  githubAppSelectedRepositoryIds,
  normalizeConnectionMetadata,
} from './connections.js';

describe('GitHub App connection metadata', () => {
  const metadata = {
    collections: {
      selection_mode: 'all' as const,
      excluded_ids: [],
      items: [
        {
          id: 'team/repo-one',
          external_id: '101',
          kind: 'repository' as const,
          name: 'repo-one',
          title: 'team/repo-one',
          url: 'https://github.com/team/repo-one',
          metadata: {
            owner: 'team',
            full_name: 'team/repo-one',
          },
        },
      ],
      project_bindings: {
        'team/repo-one': '44444444-4444-4444-8444-444444444421',
      },
    },
    github_app: {
      installation_id: 42,
      repository_selection: 'selected' as const,
      account: {
        id: 7,
        login: 'team',
        type: 'Organization',
        html_url: 'https://github.com/team',
      },
      selected_repository_ids: [101],
      selected_repositories: [
        {
          id: 101,
          name: 'repo-one',
          full_name: 'team/repo-one',
          html_url: 'https://github.com/team/repo-one',
          default_branch: 'main',
          private: true,
          archived: false,
        },
      ],
      binding: {
        target_account_login: 'team',
        bound_at: '2026-08-20T00:00:00.000Z',
        bound_via: 'webhook_installation' as const,
      },
      last_delivery: {
        id: 'delivery-1',
        event: 'installation',
        action: 'created',
        received_at: '2026-08-20T00:00:01.000Z',
      },
    },
  };

  it('normalizes GitHub App installation metadata alongside collections', () => {
    const parsed = normalizeConnectionMetadata(metadata);
    expect(parsed.github_app?.installation_id).toBe(42);
    expect(parsed.github_app?.repository_selection).toBe('selected');
    expect(parsed.collections?.project_bindings['team/repo-one']).toBe(
      '44444444-4444-4444-8444-444444444421',
    );
  });

  it('exposes installation helpers for routing and selection filters', () => {
    expect(githubAppInstallationId(metadata)).toBe(42);
    expect(githubAppSelectedRepositoryIds(metadata)).toEqual(new Set([101]));
    expect(githubAppConnectionMetadata(metadata)?.account?.login).toBe('team');
  });

  it('rejects malformed GitHub App metadata instead of keeping broken state', () => {
    const parsed = connectionMetadataSchema.parse({
      github_app: {
        installation_id: 'not-a-number',
      },
      other: 'value',
    });
    expect(parsed.github_app).toBeUndefined();
    expect(parsed.other).toBe('value');
  });
});

describe('githubAppReconcileRequestSchema', () => {
  it('bounds reconcile requests to a small explicit delivery window', () => {
    const parsed = githubAppReconcileRequestSchema.parse({
      actor_subject_id: '33333333-3333-4333-8333-333333333301',
      max_deliveries: 25,
    });
    expect(parsed.max_deliveries).toBe(25);
    expect(() =>
      githubAppReconcileRequestSchema.parse({
        actor_subject_id: '33333333-3333-4333-8333-333333333301',
        max_deliveries: 75,
      }),
    ).toThrow(/less than or equal to 50/i);
  });
});

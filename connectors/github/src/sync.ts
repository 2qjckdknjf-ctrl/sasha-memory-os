import {
  resolvePullCredentials,
  vaultRefForAccount,
  type VaultStore,
} from '@memory-os/connector-sdk';

export type GitHubSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type GitHubPullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: GitHubSyncDelta[];
};

type GithubEvent = {
  id?: string | number;
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  payload?: {
    action?: string;
    pull_request?: { number?: number; title?: string };
    issue?: { number?: number; title?: string };
  };
};

/**
 * Stub GitHub delta pull: invents PR/issue events from vault ref metadata.
 * Never loads token material — only the vault reference string.
 */
export function pullGithubStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): GitHubPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'github',
      accountId: input.connectionId,
    });
  const label = input.displayName ?? 'GitHub';
  const stamp = new Date().toISOString();

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic GitHub sync; vault credentials not read',
    items: [
      {
        externalId: `pr/${input.connectionId.slice(0, 8)}/215`,
        eventType: 'github.pull_request.updated',
        title: `${label}: PR #215 Product Design Audit`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic GitHub sync (vault ref only; credentials not read).',
          'Pull request #215 Product Design Audit merged for Slice 01 kickoff.',
          'Repos: aistroyka/core',
        ].join('\n'),
        observedAt: stamp,
      },
      {
        externalId: `issue/${input.connectionId.slice(0, 8)}/88`,
        eventType: 'github.issue.opened',
        title: `${label}: Issue #88 connector sync backlog`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic GitHub sync (vault ref only; credentials not read).',
          'Issue #88 tracks vault-backed incremental connector sync.',
          'Labels: memory-os, connectors',
        ].join('\n'),
        observedAt: stamp,
      },
    ],
  };
}

function mapGithubEvent(event: GithubEvent, vaultRef: string, label: string): GitHubSyncDelta | null {
  if (!event.id || !event.type) return null;
  const repo = event.repo?.name ?? 'unknown-repo';
  const action = event.payload?.action ?? 'updated';
  const pr = event.payload?.pull_request;
  const issue = event.payload?.issue;
  const subject = pr
    ? `PR #${pr.number ?? '?'} ${pr.title ?? ''}`.trim()
    : issue
      ? `Issue #${issue.number ?? '?'} ${issue.title ?? ''}`.trim()
      : event.type;
  return {
    externalId: `event/${event.id}`,
    eventType: `github.${event.type}`,
    title: `${label}: ${subject}`,
    text: [
      `Connector vault ref: ${vaultRef}`,
      `GitHub event ${event.type} (${action}) on ${repo}.`,
      subject,
      'Source: vault-backed GitHub user events API.',
    ].join('\n'),
    observedAt: event.created_at ?? new Date().toISOString(),
  };
}

async function pullGithubVaultDelta(input: {
  connectionId: string;
  displayName?: string;
  vaultRef: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<GitHubPullResult> {
  const response = await input.fetchImpl('https://api.github.com/user/events?per_page=5', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.accessToken}`,
      'User-Agent': 'sasha-memory-os-connector',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub events API failed: HTTP ${response.status}`);
  }

  const events = (await response.json()) as GithubEvent[];
  const label = input.displayName ?? 'GitHub';
  let items = events
    .map((event) => mapGithubEvent(event, input.vaultRef, label))
    .filter((item): item is GitHubSyncDelta => item !== null);

  if (items.length === 0) {
    items = [
      {
        externalId: `user/${input.connectionId.slice(0, 8)}/empty`,
        eventType: 'github.user.events.empty',
        title: `${label}: no recent events`,
        text: [
          `Connector vault ref: ${input.vaultRef}`,
          'Vault-backed GitHub pull succeeded but returned no recent user events.',
        ].join('\n'),
        observedAt: new Date().toISOString(),
      },
    ];
  }

  return {
    vaultRef: input.vaultRef,
    mode: 'vault',
    note: 'vault-backed GitHub user events ingested',
    items,
  };
}

/**
 * Pull GitHub deltas: vault-backed when token exists (auto/vault), else stub.
 * Tokens are read from local vault only — never from Postgres.
 */
export async function pullGithubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
}): Promise<GitHubPullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'github',
      accountId: input.connectionId,
    });
  const stub = () =>
    pullGithubStubDelta({
      env: envName,
      connectionId: input.connectionId,
      displayName: input.displayName,
      vaultRef,
    });

  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: input.vault,
  });
  if (creds.mode === 'stub') return stub();

  return pullGithubVaultDelta({
    connectionId: input.connectionId,
    displayName: input.displayName,
    vaultRef,
    accessToken: creds.accessToken,
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

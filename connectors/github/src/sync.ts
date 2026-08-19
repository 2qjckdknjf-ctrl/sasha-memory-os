import {
  buildConnectionHealthReport,
  type ConnectorCollection,
  type ConnectorDiscoverResult,
  buildDefaultCursor,
  resolvePullCredentials,
  runConnectorSync,
  vaultRefForAccount,
  type ConnectionHealthReport,
  type ConnectorSyncContext,
  type ConnectorSyncPage,
  type ExternalObject,
  type NormalizedConnectorRecord,
  type RegisteredConnector,
  type SyncCursor,
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
  nextCursor?: SyncCursor | null;
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
  __mode?: 'stub' | 'vault';
};

export type GitHubRepositoryRecord = {
  id?: string | number;
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  default_branch?: string;
  private?: boolean;
  archived?: boolean;
  owner?: { login?: string };
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GITHUB_CURSOR_STREAM = 'github:user-events';
const GITHUB_CURSOR_SCHEMA_VERSION = '1.0';
const GITHUB_PAGE_SIZE = 20;
const GITHUB_DISCOVER_PAGE_SIZE = 100;

function labelForGithubAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'GitHub';
}

function buildStubGithubEvents(input: {
  connectionId: string;
  displayName?: string;
}): GithubEvent[] {
  const stamp = new Date().toISOString();
  const repo = 'aistroyka/core';
  return [
    {
      id: `stub-pr-${input.connectionId.slice(0, 8)}-215`,
      type: 'PullRequestEvent',
      created_at: stamp,
      repo: { name: repo },
      payload: {
        action: 'closed',
        pull_request: { number: 215, title: 'Product Design Audit' },
      },
      __mode: 'stub',
    },
    {
      id: `stub-issue-${input.connectionId.slice(0, 8)}-88`,
      type: 'IssuesEvent',
      created_at: stamp,
      repo: { name: repo },
      payload: {
        action: 'opened',
        issue: { number: 88, title: 'connector sync backlog' },
      },
      __mode: 'stub',
    },
  ];
}

function buildStubGithubRepos(): GitHubRepositoryRecord[] {
  return [
    {
      id: 215001,
      name: 'aistroyka',
      full_name: 'aistroyka/core',
      html_url: 'https://github.com/aistroyka/core',
      description: 'Основной продуктовый репозиторий AISTROYKA.',
      default_branch: 'main',
      private: false,
      archived: false,
      owner: { login: 'aistroyka' },
    },
    {
      id: 215002,
      name: 'memory-os',
      full_name: 'sasha-memory-os/platform',
      html_url: 'https://github.com/sasha-memory-os/platform',
      description: 'Пилотная монорепа Sasha Memory OS.',
      default_branch: 'main',
      private: false,
      archived: false,
      owner: { login: 'sasha-memory-os' },
    },
  ];
}

function repoCollectionId(repo: Pick<GitHubRepositoryRecord, 'full_name' | 'name'>): string {
  return repo.full_name ?? repo.name ?? 'unknown-repo';
}

export function githubRepositoryToCollection(repo: GitHubRepositoryRecord): ConnectorCollection {
  const collectionId = repoCollectionId(repo);
  return {
    id: collectionId,
    external_id: repo.id != null ? String(repo.id) : collectionId,
    kind: 'repository',
    name: repo.name ?? collectionId,
    title: collectionId,
    url: repo.html_url,
    description: repo.description ?? null,
    default_branch: repo.default_branch ?? null,
    metadata: {
      owner: repo.owner?.login ?? null,
      full_name: repo.full_name ?? collectionId,
      private: repo.private ?? false,
      archived: repo.archived ?? false,
    },
  };
}

function selectedGithubRepoIds(metadata: Record<string, unknown> | undefined): Set<string> | null {
  const collections = metadata?.collections;
  if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return null;
  const items = Array.isArray((collections as { items?: unknown[] }).items)
    ? ((collections as { items: unknown[] }).items ?? [])
    : [];
  if (items.length === 0) return null;
  const excluded = new Set(
    Array.isArray((collections as { excluded_ids?: unknown[] }).excluded_ids)
      ? (collections as { excluded_ids: unknown[] }).excluded_ids
          .filter((value): value is string => typeof value === 'string')
      : [],
  );
  return new Set(
    items
      .map((item) =>
        typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
          ? (item as { id: string }).id
          : null,
      )
      .filter((value): value is string => value !== null && !excluded.has(value)),
  );
}

function filterSelectedGithubEvents(
  events: GithubEvent[],
  metadata: Record<string, unknown> | undefined,
): GithubEvent[] {
  const selectedRepos = selectedGithubRepoIds(metadata);
  if (!selectedRepos) return events;
  return events.filter((event) => {
    const repo = event.repo?.name ?? 'unknown-repo';
    return selectedRepos.has(repo);
  });
}

function nextGithubPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const segments = linkHeader.split(',');
  for (const segment of segments) {
    const match = segment.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === 'next') {
      return match[1] ?? null;
    }
  }
  return null;
}

async function resolveGithubCredentials(context: ConnectorSyncContext) {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'github',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });
  return { creds, vaultRef };
}

function eventExternalId(event: GithubEvent): string {
  return `event/${String(event.id ?? 'unknown')}`;
}

function describeGithubSubject(event: GithubEvent): {
  subject: string;
  objectType: string;
  canonicalReference?: string;
} {
  const repo = event.repo?.name ?? 'unknown-repo';
  const pr = event.payload?.pull_request;
  const issue = event.payload?.issue;
  if (pr) {
    const title = `PR #${pr.number ?? '?'} ${pr.title ?? ''}`.trim();
    return {
      subject: title,
      objectType: 'pull_request_event',
      canonicalReference:
        pr.number != null ? `https://github.com/${repo}/pull/${pr.number}` : undefined,
    };
  }
  if (issue) {
    const title = `Issue #${issue.number ?? '?'} ${issue.title ?? ''}`.trim();
    return {
      subject: title,
      objectType: 'issue_event',
      canonicalReference:
        issue.number != null ? `https://github.com/${repo}/issues/${issue.number}` : undefined,
    };
  }
  return {
    subject: event.type ?? 'GitHub event',
    objectType: 'event',
    canonicalReference: `https://github.com/${repo}`,
  };
}

function normalizeGithubEvent(input: {
  workspaceId: string;
  connectionId: string;
  displayName?: string;
  event: GithubEvent;
}): NormalizedConnectorRecord {
  const { subject, objectType, canonicalReference } = describeGithubSubject(input.event);
  const label = labelForGithubAccount(input);
  const externalId = eventExternalId(input.event);
  const observedAt = input.event.created_at ?? new Date().toISOString();
  const repo = input.event.repo?.name ?? 'unknown-repo';
  const action = input.event.payload?.action ?? 'updated';
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}`;
  const sourceMode = input.event.__mode ?? 'vault';
  const object: ExternalObject = {
    provider: 'github',
    accountId: input.connectionId,
    collectionId: repo,
    externalId,
    externalVersion: input.event.created_at,
    objectType,
    title: subject,
    contentReference: canonicalReference,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: false,
    attachments: [],
    permissionsSnapshot: {},
    metadata: {
      repo,
      action,
      eventType: input.event.type ?? 'unknown',
      sourceMode,
    },
    canonicalReference,
  };
  const note =
    sourceMode === 'stub'
      ? 'Synthetic GitHub sync (vault credentials not read).'
      : 'Source: vault-backed GitHub user events API.';
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'github',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: input.event.created_at,
      },
      event_type: `github.${input.event.type ?? 'event'}`,
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        reference: canonicalReference,
        text: `${label}: ${subject}`,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: 'reference',
      },
      provenance: {
        repo,
        action,
        sourceMode,
      },
    },
    capture: {
      title: `${label}: ${subject}`,
      text: [
        `Connector: GitHub (${sourceMode})`,
        `Repo: ${repo}`,
        `Action: ${action}`,
        `Subject: ${subject}`,
        canonicalReference ? `Reference: ${canonicalReference}` : null,
        note,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
      filename: `github://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

function filterIncrementalGithubEvents(
  events: GithubEvent[],
  cursor: SyncCursor | null | undefined,
): GithubEvent[] {
  if (!cursor?.opaque) return events;
  const lastSeenEventId =
    typeof cursor.opaque.lastSeenEventId === 'string'
      ? cursor.opaque.lastSeenEventId
      : null;
  const lastSeenObservedAt =
    typeof cursor.opaque.lastSeenObservedAt === 'string'
      ? Date.parse(cursor.opaque.lastSeenObservedAt)
      : Number.NaN;
  const next: GithubEvent[] = [];
  for (const event of events) {
    const currentEventId = String(event.id ?? '');
    if (lastSeenEventId && currentEventId === lastSeenEventId) break;
    const createdAt = Date.parse(event.created_at ?? '');
    if (Number.isFinite(lastSeenObservedAt) && Number.isFinite(createdAt)) {
      if (createdAt < lastSeenObservedAt) break;
      if (createdAt === lastSeenObservedAt && !lastSeenEventId) break;
    }
    next.push(event);
  }
  return next;
}

async function syncGithubEvents(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<GithubEvent>> {
  const { creds } = await resolveGithubCredentials(context);

  if (creds.mode === 'stub') {
    const stubEvents = filterSelectedGithubEvents(
      buildStubGithubEvents({
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
      }),
      context.account.metadata,
    );
    return {
      stream: GITHUB_CURSOR_STREAM,
      mode,
      rawObjects:
        mode === 'incremental'
          ? []
          : stubEvents,
      pullMode: 'stub',
      note: 'synthetic GitHub sync; vault credentials not read',
      nextCursor:
        mode === 'incremental'
          ? context.cursor ?? null
          : buildDefaultCursor(
              GITHUB_CURSOR_STREAM,
              {
                lastSeenEventId: `stub-pr-${context.account.connectionId.slice(0, 8)}-215`,
                lastSeenObservedAt: new Date().toISOString(),
              },
              GITHUB_CURSOR_SCHEMA_VERSION,
            ),
    };
  }

  const response = await (context.fetchImpl ?? fetch)(
    `https://api.github.com/user/events?per_page=${GITHUB_PAGE_SIZE}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${creds.accessToken}`,
        'User-Agent': 'sasha-memory-os-connector',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub events API failed: HTTP ${response.status}`);
  }

  const fetched = ((await response.json()) as GithubEvent[])
    .filter((event) => event.id && event.type)
    .map((event) => ({ ...event, __mode: 'vault' as const }));
  const selectedEvents = filterSelectedGithubEvents(fetched, context.account.metadata);
  const rawObjects =
    mode === 'incremental'
      ? filterIncrementalGithubEvents(selectedEvents, context.cursor)
      : selectedEvents;

  return {
    stream: GITHUB_CURSOR_STREAM,
    mode,
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'vault-backed GitHub user events ingested'
        : 'vault-backed GitHub sync found no new user events',
  };
}

async function discoverGithubRepositories(
  context: ConnectorSyncContext,
): Promise<ConnectorDiscoverResult> {
  const { creds } = await resolveGithubCredentials(context);

  if (creds.mode === 'stub') {
    return {
      collections: buildStubGithubRepos().map(githubRepositoryToCollection),
      note: 'synthetic GitHub discover; vault credentials not read',
    };
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${creds.accessToken}`,
    'User-Agent': 'sasha-memory-os-connector',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const repositories: GitHubRepositoryRecord[] = [];
  let pageUrl: string | null =
    `https://api.github.com/user/repos?sort=updated&per_page=${GITHUB_DISCOVER_PAGE_SIZE}`;

  while (pageUrl) {
    const response = await (context.fetchImpl ?? fetch)(pageUrl, { headers });
    if (!response.ok) {
      throw new Error(`GitHub repositories API failed: HTTP ${response.status}`);
    }
    repositories.push(...((await response.json()) as GitHubRepositoryRecord[]));
    pageUrl = nextGithubPageUrl(response.headers.get('link'));
  }

  const collections = repositories
    .filter((repo) => Boolean(repo.full_name ?? repo.name))
    .map(githubRepositoryToCollection);
  return {
    collections,
    note:
      collections.length > 0
        ? 'vault-backed GitHub repositories discovered'
        : 'vault-backed GitHub discover found no repositories',
  };
}

async function checkpointGithubEvents(input: {
  page: ConnectorSyncPage<GithubEvent>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const head = input.page.rawObjects[0];
  if (!head?.id) return input.previousCursor;
  return buildDefaultCursor(
    input.page.stream,
    {
      lastSeenEventId: String(head.id),
      lastSeenObservedAt: head.created_at ?? new Date().toISOString(),
    },
    GITHUB_CURSOR_SCHEMA_VERSION,
  );
}

async function healthcheckGithub(context: ConnectorSyncContext): Promise<ConnectionHealthReport> {
  const { creds, vaultRef } = await resolveGithubCredentials(context);

  if (creds.mode === 'stub') {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'github',
      status: 'reauth_required',
      note: 'GitHub vault token missing; OAuth reconnect required',
      vaultRef,
      checks: [
        {
          name: 'oauth_token',
          status: 'fail',
          detail: 'Vault token missing; connector is running in stub fallback mode.',
        },
      ],
    });
  }

  const response = await (context.fetchImpl ?? fetch)('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${creds.accessToken}`,
      'User-Agent': 'sasha-memory-os-connector',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'github',
      status: 'healthy',
      note: 'GitHub OAuth token is valid and the user profile probe succeeded',
      vaultRef,
      checks: [
        {
          name: 'oauth_token',
          status: 'pass',
          detail: 'Vault token loaded successfully.',
        },
        {
          name: 'provider_probe',
          status: 'pass',
          detail: 'GitHub /user probe returned HTTP 200.',
        },
      ],
    });
  }

  if (response.status === 401 || response.status === 403) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'github',
      status: 'reauth_required',
      note: `GitHub rejected the stored OAuth token with HTTP ${response.status}`,
      vaultRef,
      checks: [
        {
          name: 'provider_probe',
          status: 'fail',
          detail: `GitHub /user probe returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  return buildConnectionHealthReport({
    connectionId: context.account.connectionId,
    connectorId: 'github',
    status: 'degraded',
    note: `GitHub health probe failed with HTTP ${response.status}`,
    vaultRef,
    checks: [
      {
        name: 'provider_probe',
        status: 'warn',
        detail: `GitHub /user probe returned HTTP ${response.status}.`,
      },
    ],
  });
}

export const githubConnector: RegisteredConnector<GithubEvent> = {
  manifest: {
    id: 'github',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: GITHUB_CURSOR_STREAM,
    auth: 'oauth2',
    capabilities: ['repositories.read', 'pull_requests.read', 'issues.read', 'events.webhook'],
    supports: {
      discover: true,
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      live_fetch: true,
      webhooks: true,
      write: false,
    },
    storage_modes: ['reference', 'indexed'],
    rate_limit_strategy: 'provider_headers',
    data_classes: ['internal'],
  },
  lifecycle: {
    async discover(context) {
      return discoverGithubRepositories(context);
    },
    async validateScope() {
      return { ok: true };
    },
    async initialSync(context) {
      return syncGithubEvents(context, 'initial');
    },
    async incrementalSync(context) {
      return syncGithubEvents(context, 'incremental');
    },
    async normalize(context) {
      return normalizeGithubEvent({
        workspaceId: context.workspaceId,
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
        event: context.rawObject,
      });
    },
    async checkpoint({ page, previousCursor }) {
      return checkpointGithubEvents({ page, previousCursor });
    },
    async healthcheck(context) {
      return healthcheckGithub(context);
    },
    async revoke(context) {
      if (context.vault && context.account.vaultRef) {
        await context.vault.delete(context.account.vaultRef);
      }
    },
  },
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
  const items = buildStubGithubEvents({
    connectionId: input.connectionId,
    displayName: input.displayName,
  }).map((event) => {
    const record = normalizeGithubEvent({
      workspaceId: DEFAULT_WORKSPACE_ID,
      connectionId: input.connectionId,
      displayName: input.displayName,
      event,
    });
    return {
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    };
  });

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic GitHub sync; vault credentials not read',
    items,
    nextCursor: buildDefaultCursor(
      GITHUB_CURSOR_STREAM,
      {
        lastSeenEventId: String(buildStubGithubEvents({ connectionId: input.connectionId })[0]?.id ?? ''),
        lastSeenObservedAt: new Date().toISOString(),
      },
      GITHUB_CURSOR_SCHEMA_VERSION,
    ),
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
  workspaceId?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  cursor?: SyncCursor | null;
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
  const syncRun = await runConnectorSync({
    connector: githubConnector,
    context: {
      account: {
        connectionId: input.connectionId,
        connectorId: 'github',
        displayName: input.displayName,
        vaultRef,
      },
      workspaceId:
        input.workspaceId ??
        processEnv.MEMORY_OS_WORKSPACE_ID ??
        DEFAULT_WORKSPACE_ID,
      processEnv: {
        ...processEnv,
        MEMORY_OS_ENV: envName,
      },
      vault: input.vault,
      fetchImpl: input.fetchImpl ?? fetch,
      cursor: input.cursor ?? null,
    },
  });

  return {
    vaultRef,
    mode: syncRun.page.pullMode === 'stub' ? 'stub' : 'vault',
    note: syncRun.page.note ?? 'GitHub connector sync completed',
    items: syncRun.records.map((record) => ({
      externalId: record.externalObject.externalId,
      eventType: record.envelope.event_type,
      title: record.capture.title,
      text: record.capture.text,
      observedAt: record.envelope.observed_at,
    })),
    nextCursor: syncRun.nextCursor,
  };
}

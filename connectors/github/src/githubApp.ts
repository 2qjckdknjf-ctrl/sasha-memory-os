import { createSign } from 'node:crypto';

export type GitHubAppWebhookDelivery = {
  id: number;
  guid: string;
  delivered_at: string;
  redelivery: boolean;
  duration: number;
  status: string;
  status_code: number;
  event: string;
  action: string | null;
  installation_id: number | null;
  repository_id: number | null;
  throttled_at?: string | null;
};

export type GitHubAppWebhookDeliveryDetail = GitHubAppWebhookDelivery & {
  request?: {
    headers?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
  };
  response?: {
    headers?: Record<string, unknown> | null;
    payload?: string | null;
  };
};

const DEFAULT_GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_GITHUB_API_VERSION = '2022-11-28';

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function normalizeGitHubAppPrivateKey(privateKey: string): string {
  return privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
}

function parseNextCursor(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const segment of linkHeader.split(',')) {
    const match = segment.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] !== 'next') continue;
    const nextUrl = new URL(match[1]);
    return nextUrl.searchParams.get('cursor');
  }
  return null;
}

function isRelevantDelivery(input: {
  delivery: GitHubAppWebhookDelivery;
  installationId: number;
  selectedRepositoryIds: Set<number>;
}): boolean {
  if (input.delivery.installation_id !== input.installationId) return false;
  if (input.delivery.event === 'installation' || input.delivery.event === 'installation_repositories') {
    return true;
  }
  if (input.selectedRepositoryIds.size === 0) return false;
  if (input.delivery.repository_id == null) return false;
  return input.selectedRepositoryIds.has(input.delivery.repository_id);
}

export function createGitHubAppJwt(input: {
  appId: string;
  privateKey: string;
  now?: number;
}): string {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: input.appId,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(normalizeGitHubAppPrivateKey(input.privateKey), 'base64url');
  return `${header}.${payload}.${signature}`;
}

export async function listGitHubAppWebhookDeliveries(input: {
  appId: string;
  privateKey: string;
  cursor?: string | null;
  perPage?: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  deliveries: GitHubAppWebhookDelivery[];
  nextCursor: string | null;
}> {
  const perPage = Math.min(Math.max(input.perPage ?? 25, 1), 100);
  const url = new URL('/app/hook/deliveries', input.apiBase ?? DEFAULT_GITHUB_API_BASE);
  url.searchParams.set('per_page', String(perPage));
  if (input.cursor) url.searchParams.set('cursor', input.cursor);
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${createGitHubAppJwt(input)}`,
      'User-Agent': 'sasha-memory-os-connector',
      'X-GitHub-Api-Version': DEFAULT_GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub App webhook deliveries API failed: HTTP ${response.status}`);
  }
  return {
    deliveries: (await response.json()) as GitHubAppWebhookDelivery[],
    nextCursor: parseNextCursor(response.headers.get('link')),
  };
}

export async function getGitHubAppWebhookDelivery(input: {
  appId: string;
  privateKey: string;
  deliveryId: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<GitHubAppWebhookDeliveryDetail> {
  const url = new URL(`/app/hook/deliveries/${input.deliveryId}`, input.apiBase ?? DEFAULT_GITHUB_API_BASE);
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${createGitHubAppJwt(input)}`,
      'User-Agent': 'sasha-memory-os-connector',
      'X-GitHub-Api-Version': DEFAULT_GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub App webhook delivery detail API failed: HTTP ${response.status}`);
  }
  return (await response.json()) as GitHubAppWebhookDeliveryDetail;
}

export async function reconcileGitHubAppWebhookDeliveries(input: {
  appId: string;
  privateKey: string;
  installationId: number;
  selectedRepositoryIds?: Iterable<number>;
  seenDeliveryIds?: Iterable<string>;
  maxDeliveries?: number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  deliveries: GitHubAppWebhookDeliveryDetail[];
  inspectedCount: number;
  matchedCount: number;
  truncated: boolean;
  nextCursor: string | null;
}> {
  const seenDeliveryIds = new Set(input.seenDeliveryIds ?? []);
  const selectedRepositoryIds = new Set(input.selectedRepositoryIds ?? []);
  const maxDeliveries = Math.min(Math.max(input.maxDeliveries ?? 25, 1), 50);

  const listed = await listGitHubAppWebhookDeliveries({
    appId: input.appId,
    privateKey: input.privateKey,
    perPage: maxDeliveries,
    apiBase: input.apiBase,
    fetchImpl: input.fetchImpl,
  });

  const relevant = listed.deliveries.filter((delivery) =>
    isRelevantDelivery({
      delivery,
      installationId: input.installationId,
      selectedRepositoryIds,
    }),
  );

  const missing = relevant.filter((delivery) => !seenDeliveryIds.has(delivery.guid));
  const details = await Promise.all(
    missing.map((delivery) =>
      getGitHubAppWebhookDelivery({
        appId: input.appId,
        privateKey: input.privateKey,
        deliveryId: delivery.id,
        apiBase: input.apiBase,
        fetchImpl: input.fetchImpl,
      }),
    ),
  );

  details.sort((left, right) => Date.parse(left.delivered_at) - Date.parse(right.delivered_at));

  return {
    deliveries: details,
    inspectedCount: listed.deliveries.length,
    matchedCount: relevant.length,
    truncated: relevant.length > missing.length && missing.length >= maxDeliveries,
    nextCursor: listed.nextCursor,
  };
}

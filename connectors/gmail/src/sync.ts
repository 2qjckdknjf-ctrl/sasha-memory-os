import {
  resolvePullCredentials,
  vaultRefForAccount,
  type VaultStore,
} from '@memory-os/connector-sdk';

export type GmailSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type GmailPullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: GmailSyncDelta[];
};

type GmailListResponse = {
  messages?: Array<{ id?: string }>;
};

type GmailMessage = {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
};

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  const hit = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return hit?.value?.trim() || null;
}

/** Stub Gmail delta: invents metadata-only message events from vault ref. */
export function pullGmailStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): GmailPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'gmail',
      accountId: input.connectionId,
    });
  const label = input.displayName ?? 'Gmail';
  const stamp = new Date().toISOString();

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Gmail sync; vault credentials not read',
    items: [
      {
        externalId: `msg/${input.connectionId.slice(0, 8)}/pilot`,
        eventType: 'gmail.message.metadata',
        title: `${label}: Pilot inbox thread metadata`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic Gmail sync (credentials not read; bodies not stored).',
          'Thread subject: Memory OS pilot kickoff',
          'Labels: INBOX, memory-os',
        ].join('\n'),
        observedAt: stamp,
      },
    ],
  };
}

async function pullGmailVaultDelta(input: {
  connectionId: string;
  displayName?: string;
  vaultRef: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<GmailPullResult> {
  const label = input.displayName ?? 'Gmail';
  const listRes = await input.fetchImpl(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX',
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!listRes.ok) {
    throw new Error(`Gmail list API failed: HTTP ${listRes.status}`);
  }
  const list = (await listRes.json()) as GmailListResponse;
  const ids = (list.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, 5);

  const items: GmailSyncDelta[] = [];
  for (const id of ids) {
    const msgRes = await input.fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          Accept: 'application/json',
        },
      },
    );
    if (!msgRes.ok) continue;
    const msg = (await msgRes.json()) as GmailMessage;
    const subject =
      headerValue(msg.payload?.headers, 'Subject') ?? '(no subject)';
    const from = headerValue(msg.payload?.headers, 'From') ?? 'unknown';
    const observedAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString();
    items.push({
      externalId: `msg/${id}`,
      eventType: 'gmail.message.metadata',
      title: `${label}: ${subject}`,
      text: [
        `Connector vault ref: ${input.vaultRef}`,
        `From: ${from}`,
        `Subject: ${subject}`,
        msg.snippet ? `Snippet: ${msg.snippet}` : 'Metadata-only Gmail pull (no full body stored).',
        'Source: vault-backed Gmail messages.list + metadata.',
      ].join('\n'),
      observedAt,
    });
  }

  if (items.length === 0) {
    items.push({
      externalId: `msg/${input.connectionId.slice(0, 8)}/empty`,
      eventType: 'gmail.message.empty',
      title: `${label}: no recent inbox messages`,
      text: [
        `Connector vault ref: ${input.vaultRef}`,
        'Vault-backed Gmail pull succeeded but inbox returned no messages.',
      ].join('\n'),
      observedAt: new Date().toISOString(),
    });
  }

  return {
    vaultRef: input.vaultRef,
    mode: 'vault',
    note: 'vault-backed Gmail metadata ingested',
    items,
  };
}

/** Pull Gmail deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGmailDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
}): Promise<GmailPullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'gmail',
      accountId: input.connectionId,
    });
  const stub = () =>
    pullGmailStubDelta({
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

  return pullGmailVaultDelta({
    connectionId: input.connectionId,
    displayName: input.displayName,
    vaultRef,
    accessToken: creds.accessToken,
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

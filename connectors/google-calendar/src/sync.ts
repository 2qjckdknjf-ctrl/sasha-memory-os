import {
  resolvePullCredentials,
  vaultRefForAccount,
  type VaultStore,
} from '@memory-os/connector-sdk';

export type CalendarSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type CalendarPullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: CalendarSyncDelta[];
};

type CalendarListResponse = {
  items?: Array<{
    id?: string;
    summary?: string;
    status?: string;
    updated?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>;
};

/** Stub Calendar delta: invents event metadata from vault ref only. */
export function pullGoogleCalendarStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): CalendarPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'google-calendar',
      accountId: input.connectionId,
    });
  const label = input.displayName ?? 'Google Calendar';
  const stamp = new Date().toISOString();

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Google Calendar sync; vault credentials not read',
    items: [
      {
        externalId: `event/${input.connectionId.slice(0, 8)}/standup`,
        eventType: 'calendar.event.upserted',
        title: `${label}: AISTROYKA standup`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic Google Calendar sync (credentials not read).',
          'Event: AISTROYKA standup — Memory OS pilot review.',
        ].join('\n'),
        observedAt: stamp,
      },
    ],
  };
}

async function pullGoogleCalendarVaultDelta(input: {
  connectionId: string;
  displayName?: string;
  vaultRef: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<CalendarPullResult> {
  const label = input.displayName ?? 'Google Calendar';
  const timeMin = encodeURIComponent(new Date().toISOString());
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&singleEvents=true&orderBy=startTime&timeMin=${timeMin}`;
  const response = await input.fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Google Calendar events API failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as CalendarListResponse;
  const events = payload.items ?? [];
  const items: CalendarSyncDelta[] = events
    .filter((event) => event.id)
    .map((event) => {
      const summary = event.summary?.trim() || '(untitled event)';
      const start = event.start?.dateTime ?? event.start?.date ?? 'unknown';
      const end = event.end?.dateTime ?? event.end?.date ?? 'unknown';
      return {
        externalId: `event/${event.id}`,
        eventType: 'calendar.event.upserted',
        title: `${label}: ${summary}`,
        text: [
          `Connector vault ref: ${input.vaultRef}`,
          `Event: ${summary}`,
          `Status: ${event.status ?? 'confirmed'}`,
          `Start: ${start}`,
          `End: ${end}`,
          'Source: vault-backed Google Calendar events.list.',
        ].join('\n'),
        observedAt: event.updated ?? new Date().toISOString(),
      };
    });

  if (items.length === 0) {
    items.push({
      externalId: `event/${input.connectionId.slice(0, 8)}/empty`,
      eventType: 'calendar.event.empty',
      title: `${label}: no upcoming events`,
      text: [
        `Connector vault ref: ${input.vaultRef}`,
        'Vault-backed Calendar pull succeeded but returned no upcoming events.',
      ].join('\n'),
      observedAt: new Date().toISOString(),
    });
  }

  return {
    vaultRef: input.vaultRef,
    mode: 'vault',
    note: 'vault-backed Google Calendar events ingested',
    items,
  };
}

/** Pull Calendar deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGoogleCalendarDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
}): Promise<CalendarPullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-calendar',
      accountId: input.connectionId,
    });
  const stub = () =>
    pullGoogleCalendarStubDelta({
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

  return pullGoogleCalendarVaultDelta({
    connectionId: input.connectionId,
    displayName: input.displayName,
    vaultRef,
    accessToken: creds.accessToken,
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

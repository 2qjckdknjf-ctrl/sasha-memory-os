import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  connectorRateLimitError,
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
  nextCursor?: SyncCursor | null;
};

type CalendarEvent = {
  id?: string;
  summary?: string;
  status?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  __mode?: 'stub' | 'vault';
};

type CalendarListResponse = {
  items?: CalendarEvent[];
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CALENDAR_CURSOR_STREAM = 'google-calendar:events';
const CALENDAR_CURSOR_SCHEMA_VERSION = '1.0';
const CALENDAR_PAGE_SIZE = 5;

function labelForCalendarAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Google Calendar';
}

function buildStubCalendarEvents(input: {
  connectionId: string;
  displayName?: string;
}): CalendarEvent[] {
  const stamp = new Date().toISOString();
  return [
    {
      id: `stub-${input.connectionId.slice(0, 8)}-standup`,
      summary: 'AISTROYKA standup',
      status: 'confirmed',
      updated: stamp,
      start: { dateTime: stamp },
      end: { dateTime: new Date(Date.now() + 30 * 60_000).toISOString() },
      __mode: 'stub',
    },
  ];
}

function calendarEventExternalId(event: CalendarEvent): string {
  return `event/${String(event.id ?? 'unknown')}`;
}

function normalizeCalendarEvent(input: {
  workspaceId: string;
  connectionId: string;
  displayName?: string;
  event: CalendarEvent;
}): NormalizedConnectorRecord {
  const label = labelForCalendarAccount(input);
  const externalId = calendarEventExternalId(input.event);
  const summary = input.event.summary?.trim() || '(untitled event)';
  const start = input.event.start?.dateTime ?? input.event.start?.date ?? 'unknown';
  const end = input.event.end?.dateTime ?? input.event.end?.date ?? 'unknown';
  const observedAt = input.event.updated ?? new Date().toISOString();
  const sourceMode = input.event.__mode ?? 'vault';
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}`;
  const object: ExternalObject = {
    provider: 'google-calendar',
    accountId: input.connectionId,
    externalId,
    externalVersion: input.event.updated,
    objectType: 'calendar_event',
    title: summary,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: false,
    attachments: [],
    permissionsSnapshot: {},
    metadata: {
      status: input.event.status ?? 'confirmed',
      start,
      end,
      sourceMode,
    },
  };
  const note =
    sourceMode === 'stub'
      ? 'Synthetic Google Calendar sync (vault credentials not read).'
      : 'Source: vault-backed Google Calendar events.list.';
  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'google-calendar',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: input.event.updated,
      },
      event_type: 'google-calendar.event.upserted',
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        text: `${label}: ${summary}`,
      },
      scope: {
        sensitivity: 'internal',
        storage_mode: 'reference',
      },
      provenance: {
        status: input.event.status ?? 'confirmed',
        sourceMode,
      },
    },
    capture: {
      title: `${label}: ${summary}`,
      text: [
        `Connector: Google Calendar (${sourceMode})`,
        `Event: ${summary}`,
        `Status: ${input.event.status ?? 'confirmed'}`,
        `Start: ${start}`,
        `End: ${end}`,
        note,
      ].join('\n'),
      filename: `google-calendar://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
}

function filterIncrementalCalendarEvents(
  events: CalendarEvent[],
  cursor: SyncCursor | null | undefined,
): CalendarEvent[] {
  if (!cursor?.opaque) return events;
  const lastSeenEventId =
    typeof cursor.opaque.lastSeenEventId === 'string' ? cursor.opaque.lastSeenEventId : null;
  const lastSeenUpdatedAt =
    typeof cursor.opaque.lastSeenUpdatedAt === 'string'
      ? Date.parse(cursor.opaque.lastSeenUpdatedAt)
      : Number.NaN;
  const next: CalendarEvent[] = [];
  for (const event of events) {
    const currentEventId = String(event.id ?? '');
    if (lastSeenEventId && currentEventId === lastSeenEventId) break;
    const updatedAt = Date.parse(event.updated ?? '');
    if (Number.isFinite(lastSeenUpdatedAt) && Number.isFinite(updatedAt)) {
      if (updatedAt < lastSeenUpdatedAt) break;
      if (updatedAt === lastSeenUpdatedAt && !lastSeenEventId) break;
    }
    next.push(event);
  }
  return next;
}

async function syncGoogleCalendarEvents(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<CalendarEvent>> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-calendar',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (creds.mode === 'stub') {
    const rawObjects =
      mode === 'incremental'
        ? []
        : buildStubCalendarEvents({
            connectionId: context.account.connectionId,
            displayName: context.account.displayName,
          });
    const head = rawObjects[0];
    return {
      stream: CALENDAR_CURSOR_STREAM,
      mode,
      rawObjects,
      pullMode: 'stub',
      note: 'synthetic Google Calendar sync; vault credentials not read',
      nextCursor:
        mode === 'incremental' || !head?.id
          ? context.cursor ?? null
          : buildDefaultCursor(
              CALENDAR_CURSOR_STREAM,
              {
                lastSeenEventId: String(head.id),
                lastSeenUpdatedAt: head.updated ?? new Date().toISOString(),
              },
              CALENDAR_CURSOR_SCHEMA_VERSION,
            ),
    };
  }

  const timeMin = encodeURIComponent(new Date().toISOString());
  const response = await (context.fetchImpl ?? fetch)(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${CALENDAR_PAGE_SIZE}&singleEvents=true&orderBy=updated&timeMin=${timeMin}`,
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    if (response.status === 429) {
      throw connectorRateLimitError({
        message: `Google Calendar events API failed: HTTP ${response.status}`,
      });
    }
    throw new Error(`Google Calendar events API failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as CalendarListResponse;
  const fetched = (payload.items ?? [])
    .filter((event) => event.id)
    .map((event) => ({ ...event, __mode: 'vault' as const }));
  const rawObjects =
    mode === 'incremental'
      ? filterIncrementalCalendarEvents(fetched, context.cursor)
      : fetched;
  return {
    stream: CALENDAR_CURSOR_STREAM,
    mode,
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'vault-backed Google Calendar events ingested'
        : 'vault-backed Google Calendar sync found no new events',
  };
}

async function checkpointCalendarEvents(input: {
  page: ConnectorSyncPage<CalendarEvent>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  const head = input.page.rawObjects[0];
  if (!head?.id) return input.previousCursor;
  return buildDefaultCursor(
    input.page.stream,
    {
      lastSeenEventId: String(head.id),
      lastSeenUpdatedAt: head.updated ?? new Date().toISOString(),
    },
    CALENDAR_CURSOR_SCHEMA_VERSION,
  );
}

async function healthcheckGoogleCalendar(
  context: ConnectorSyncContext,
): Promise<ConnectionHealthReport> {
  const processEnv = context.processEnv ?? process.env;
  const envName = context.processEnv?.MEMORY_OS_ENV ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    context.account.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-calendar',
      accountId: context.account.connectionId,
    });
  const creds = await resolvePullCredentials({
    vaultRef,
    processEnv,
    vault: context.vault,
    fetchImpl: context.fetchImpl,
  });

  if (creds.mode === 'stub') {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-calendar',
      status: 'reauth_required',
      note: 'Google Calendar vault token missing; OAuth reconnect required',
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

  const response = await (context.fetchImpl ?? fetch)(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&singleEvents=true&orderBy=updated',
    {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  if (response.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-calendar',
      status: 'healthy',
      note: 'Google Calendar OAuth token is valid and the events probe succeeded',
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
          detail: 'Google Calendar events probe returned HTTP 200.',
        },
      ],
    });
  }

  if (response.status === 401 || response.status === 403) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-calendar',
      status: 'reauth_required',
      note: `Google Calendar rejected the stored OAuth token with HTTP ${response.status}`,
      vaultRef,
      checks: [
        {
          name: 'provider_probe',
          status: 'fail',
          detail: `Google Calendar events probe returned HTTP ${response.status}.`,
        },
      ],
    });
  }

  return buildConnectionHealthReport({
    connectionId: context.account.connectionId,
    connectorId: 'google-calendar',
    status: 'degraded',
    note: `Google Calendar health probe failed with HTTP ${response.status}`,
    vaultRef,
    checks: [
      {
        name: 'provider_probe',
        status: 'warn',
        detail: `Google Calendar events probe returned HTTP ${response.status}.`,
      },
    ],
  });
}

export const googleCalendarConnector: RegisteredConnector<CalendarEvent> = {
  manifest: {
    id: 'google-calendar',
    version: '1.0.0',
    sdk_version: '^1.0',
    default_stream: CALENDAR_CURSOR_STREAM,
    auth: 'oauth2',
    capabilities: ['events.read'],
    supports: {
      discover: false,
      validate_scope: true,
      initial_sync: true,
      incremental_sync: true,
      live_fetch: false,
      webhooks: false,
      write: false,
    },
    storage_modes: ['reference', 'indexed'],
    rate_limit_strategy: 'provider_headers',
    data_classes: ['internal'],
  },
  lifecycle: {
    async validateScope() {
      return { ok: true };
    },
    async initialSync(context) {
      return syncGoogleCalendarEvents(context, 'initial');
    },
    async incrementalSync(context) {
      return syncGoogleCalendarEvents(context, 'incremental');
    },
    async normalize(context) {
      return normalizeCalendarEvent({
        workspaceId: context.workspaceId,
        connectionId: context.account.connectionId,
        displayName: context.account.displayName,
        event: context.rawObject,
      });
    },
    async checkpoint({ page, previousCursor }) {
      return checkpointCalendarEvents({ page, previousCursor });
    },
    async healthcheck(context) {
      return healthcheckGoogleCalendar(context);
    },
    async revoke(context) {
      if (context.vault && context.account.vaultRef) {
        await context.vault.delete(context.account.vaultRef);
      }
    },
  },
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
  const items = buildStubCalendarEvents({
    connectionId: input.connectionId,
    displayName: input.displayName,
  }).map((event) => {
    const record = normalizeCalendarEvent({
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
  const head = buildStubCalendarEvents({
    connectionId: input.connectionId,
    displayName: input.displayName,
  })[0];

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Google Calendar sync; vault credentials not read',
    items,
    nextCursor: head?.id
      ? buildDefaultCursor(
          CALENDAR_CURSOR_STREAM,
          {
            lastSeenEventId: String(head.id),
            lastSeenUpdatedAt: head.updated ?? new Date().toISOString(),
          },
          CALENDAR_CURSOR_SCHEMA_VERSION,
        )
      : null,
  };
}

/** Pull Calendar deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGoogleCalendarDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  workspaceId?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
  cursor?: SyncCursor | null;
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
  const syncRun = await runConnectorSync({
    connector: googleCalendarConnector,
    context: {
      account: {
        connectionId: input.connectionId,
        connectorId: 'google-calendar',
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
    note: syncRun.page.note ?? 'Google Calendar connector sync completed',
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

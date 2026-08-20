import {
  buildConnectionHealthReport,
  buildDefaultCursor,
  classifyConnectorError,
  connectorCursorExpiredError,
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

type CalendarStorageMode = 'reference';
type CalendarChangeState = 'active' | 'cancelled' | 'missing_from_selected_resync';

type CalendarSelectedCalendar = {
  collectionId: string;
  externalId: string;
  name: string;
  title: string;
  storageMode: CalendarStorageMode;
};

type CalendarCursorEntry = {
  calendarId: string;
  collectionId: string;
  syncToken: string | null;
};

type CalendarKnownEvent = {
  calendarId: string;
  calendarTitle: string;
  collectionId: string;
  eventId: string;
  title: string | null;
  storageMode: CalendarStorageMode;
};

type CalendarCursorState = {
  scopeKey: string | null;
  queryKey: string | null;
  calendarTokens: CalendarCursorEntry[];
  knownEvents: CalendarKnownEvent[];
};

type CalendarEventTime = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

type CalendarEventAttendee = {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
};

type CalendarEventActor = {
  email?: string;
  displayName?: string;
  self?: boolean;
};

type CalendarApiEvent = {
  id?: string;
  summary?: string;
  status?: string;
  updated?: string;
  created?: string;
  description?: string;
  htmlLink?: string;
  location?: string;
  recurringEventId?: string;
  originalStartTime?: CalendarEventTime;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
  attendees?: CalendarEventAttendee[];
  organizer?: CalendarEventActor;
  creator?: CalendarEventActor;
  iCalUID?: string;
  eventType?: string;
};

type CalendarEvent = CalendarApiEvent & {
  calendarId: string;
  calendarTitle: string;
  collectionId: string;
  storageMode: CalendarStorageMode;
  __mode?: 'stub' | 'vault';
  deleted: boolean;
  changeState: CalendarChangeState;
};

type CalendarListResponse = {
  items?: CalendarApiEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

const DEFAULT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CALENDAR_CURSOR_STREAM = 'google-calendar:events';
const CALENDAR_CURSOR_SCHEMA_VERSION = '2.0';
const CALENDAR_PAGE_SIZE = 250;
const CALENDAR_COLLECTION_PREFIX = 'google-calendar:calendar:';
const CALENDAR_STORAGE_MODE: CalendarStorageMode = 'reference';
const CALENDAR_QUERY_OPTIONS = {
  maxResults: String(CALENDAR_PAGE_SIZE),
  showDeleted: 'true',
  singleEvents: 'true',
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelForCalendarAccount(input: {
  displayName?: string;
  connectionId: string;
}): string {
  return input.displayName ?? 'Google Calendar';
}

function deriveCalendarExternalId(collectionId: string): string | null {
  return collectionId.startsWith(CALENDAR_COLLECTION_PREFIX)
    ? collectionId.slice(CALENDAR_COLLECTION_PREFIX.length)
    : null;
}

export function resolveGoogleCalendarSelectedCalendars(
  metadata: unknown,
): CalendarSelectedCalendar[] {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.collections)) return [];
  if (metadata.collections.selection_mode !== 'selected') return [];
  const excluded = new Set(
    Array.isArray(metadata.collections.excluded_ids)
      ? metadata.collections.excluded_ids.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [],
  );
  const rawItems = Array.isArray(metadata.collections.items) ? metadata.collections.items : [];
  return rawItems.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const collectionId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!collectionId || excluded.has(collectionId)) return [];
    const kind = typeof item.kind === 'string' ? item.kind : 'collection';
    if (kind !== 'calendar' && kind !== 'collection') return [];
    const externalId =
      typeof item.external_id === 'string' && item.external_id.trim().length > 0
        ? item.external_id.trim()
        : deriveCalendarExternalId(collectionId);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const title =
      typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : name;
    if (!externalId || !name || !title) return [];
    return [
      {
        collectionId,
        externalId,
        name,
        title,
        storageMode: CALENDAR_STORAGE_MODE,
      } satisfies CalendarSelectedCalendar,
    ];
  });
}

export function validateGoogleCalendarSelectionScope(metadata: unknown): {
  ok: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!isPlainObject(metadata) || !isPlainObject(metadata.collections)) {
    missing.push('metadata.collections');
    return { ok: false, missing };
  }
  if (metadata.collections.selection_mode !== 'selected') {
    missing.push('collections.selection_mode=selected');
  }
  if (resolveGoogleCalendarSelectedCalendars(metadata).length === 0) {
    missing.push('selected Google Calendar calendars');
  }
  return {
    ok: missing.length === 0,
    missing,
  };
}

function buildCalendarScopeKey(calendars: CalendarSelectedCalendar[]): string {
  return calendars
    .map((calendar) => `${calendar.collectionId}:${calendar.externalId}:${calendar.storageMode}`)
    .sort()
    .join('|');
}

function buildCalendarQueryKey(): string {
  const params = new URLSearchParams();
  params.set('maxResults', CALENDAR_QUERY_OPTIONS.maxResults);
  params.set('showDeleted', CALENDAR_QUERY_OPTIONS.showDeleted);
  params.set('singleEvents', CALENDAR_QUERY_OPTIONS.singleEvents);
  return params.toString();
}

function parseCalendarCursorState(
  cursor: SyncCursor | null | undefined,
): CalendarCursorState {
  const calendarTokens = Array.isArray(cursor?.opaque?.calendarTokens)
    ? cursor.opaque.calendarTokens.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const calendarId = typeof entry.calendarId === 'string' ? entry.calendarId.trim() : '';
        const collectionId =
          typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
        if (!calendarId || !collectionId) return [];
        return [
          {
            calendarId,
            collectionId,
            syncToken:
              typeof entry.syncToken === 'string' && entry.syncToken.trim().length > 0
                ? entry.syncToken.trim()
                : null,
          } satisfies CalendarCursorEntry,
        ];
      })
    : [];
  const knownEvents = Array.isArray(cursor?.opaque?.knownEvents)
    ? cursor.opaque.knownEvents.flatMap((entry) => {
        if (!isPlainObject(entry)) return [];
        const calendarId = typeof entry.calendarId === 'string' ? entry.calendarId.trim() : '';
        const calendarTitle =
          typeof entry.calendarTitle === 'string' && entry.calendarTitle.trim().length > 0
            ? entry.calendarTitle.trim()
            : calendarId;
        const collectionId =
          typeof entry.collectionId === 'string' ? entry.collectionId.trim() : '';
        const eventId = typeof entry.eventId === 'string' ? entry.eventId.trim() : '';
        if (!calendarId || !collectionId || !eventId) return [];
        return [
          {
            calendarId,
            calendarTitle,
            collectionId,
            eventId,
            title: typeof entry.title === 'string' ? entry.title : null,
            storageMode: CALENDAR_STORAGE_MODE,
          } satisfies CalendarKnownEvent,
        ];
      })
    : [];
  return {
    scopeKey: typeof cursor?.opaque?.scopeKey === 'string' ? cursor.opaque.scopeKey : null,
    queryKey: typeof cursor?.opaque?.queryKey === 'string' ? cursor.opaque.queryKey : null,
    calendarTokens,
    knownEvents,
  };
}

function buildCalendarCursor(input: {
  selectedCalendars: CalendarSelectedCalendar[];
  calendarTokens: Iterable<CalendarCursorEntry>;
  knownEvents: Iterable<CalendarKnownEvent>;
}): SyncCursor {
  return buildDefaultCursor(
    CALENDAR_CURSOR_STREAM,
    {
      scopeKey: buildCalendarScopeKey(input.selectedCalendars),
      queryKey: buildCalendarQueryKey(),
      calendarTokens: [...input.calendarTokens].sort((left, right) =>
        `${left.collectionId}:${left.calendarId}`.localeCompare(
          `${right.collectionId}:${right.calendarId}`,
        ),
      ),
      knownEvents: [...input.knownEvents].sort((left, right) =>
        buildCalendarKnownEventKey(left.calendarId, left.eventId).localeCompare(
          buildCalendarKnownEventKey(right.calendarId, right.eventId),
        ),
      ),
    },
    CALENDAR_CURSOR_SCHEMA_VERSION,
  );
}

function sanitizeObservedAt(value?: string): string {
  if (!value) return new Date().toISOString();
  const stamp = new Date(value);
  return Number.isNaN(stamp.valueOf()) ? new Date().toISOString() : stamp.toISOString();
}

function resolveCalendarInstant(value?: CalendarEventTime): string {
  return value?.dateTime ?? value?.date ?? 'unknown';
}

function buildCalendarKnownEventKey(calendarId: string, eventId: string): string {
  return `${calendarId}:${eventId}`;
}

function calendarEventExternalId(
  event: Pick<CalendarEvent, 'calendarId' | 'id'>,
): string {
  return `calendar/${event.calendarId}/event/${String(event.id ?? 'unknown')}`;
}

function buildKnownCalendarEvent(rawObject: CalendarEvent): CalendarKnownEvent | null {
  if (!rawObject.id || rawObject.deleted) return null;
  return {
    calendarId: rawObject.calendarId,
    calendarTitle: rawObject.calendarTitle,
    collectionId: rawObject.collectionId,
    eventId: rawObject.id,
    title: rawObject.summary?.trim() || null,
    storageMode: rawObject.storageMode,
  };
}

function buildCalendarEventFromApi(input: {
  event: CalendarApiEvent;
  selectedCalendar: CalendarSelectedCalendar;
  mode: 'stub' | 'vault';
}): CalendarEvent | null {
  if (!input.event.id) return null;
  const deleted = input.event.status === 'cancelled';
  return {
    ...input.event,
    calendarId: input.selectedCalendar.externalId,
    calendarTitle: input.selectedCalendar.title,
    collectionId: input.selectedCalendar.collectionId,
    storageMode: input.selectedCalendar.storageMode,
    __mode: input.mode,
    deleted,
    changeState: deleted ? 'cancelled' : 'active',
  };
}

function buildCalendarTombstone(input: {
  calendarId: string;
  calendarTitle: string;
  collectionId: string;
  eventId: string;
  title?: string | null;
  observedAt: string;
  changeState: 'cancelled' | 'missing_from_selected_resync';
  status?: string;
  created?: string;
  updated?: string;
  start?: CalendarEventTime;
  end?: CalendarEventTime;
  description?: string;
  htmlLink?: string;
  location?: string;
  recurringEventId?: string;
  originalStartTime?: CalendarEventTime;
  attendees?: CalendarEventAttendee[];
  organizer?: CalendarEventActor;
  creator?: CalendarEventActor;
  iCalUID?: string;
  eventType?: string;
}): CalendarEvent {
  return {
    id: input.eventId,
    summary: input.title ?? '(untitled event)',
    status:
      input.changeState === 'cancelled'
        ? (input.status ?? 'cancelled')
        : 'cancelled',
    created: input.created,
    updated: input.updated ?? input.observedAt,
    start: input.start,
    end: input.end,
    description: input.description,
    htmlLink: input.htmlLink,
    location: input.location,
    recurringEventId: input.recurringEventId,
    originalStartTime: input.originalStartTime,
    attendees: input.attendees,
    organizer: input.organizer,
    creator: input.creator,
    iCalUID: input.iCalUID,
    eventType: input.eventType,
    calendarId: input.calendarId,
    calendarTitle: input.calendarTitle,
    collectionId: input.collectionId,
    storageMode: CALENDAR_STORAGE_MODE,
    __mode: 'vault',
    deleted: true,
    changeState: input.changeState,
  };
}

function buildStubCalendarEvents(input: {
  connectionId: string;
  metadata?: unknown;
}): CalendarEvent[] {
  const selectedCalendar = resolveGoogleCalendarSelectedCalendars(input.metadata)[0];
  if (!selectedCalendar) return [];
  const stamp = new Date().toISOString();
  return [
    {
      id: `stub-${input.connectionId.slice(0, 8)}-selected-calendar`,
      summary: `${selectedCalendar.title} synthetic selected-calendar event`,
      status: 'confirmed',
      updated: stamp,
      start: { dateTime: stamp },
      end: { dateTime: new Date(Date.now() + 30 * 60_000).toISOString() },
      description:
        'Synthetic selected-calendar event used for local certification when vault credentials are unavailable.',
      calendarId: selectedCalendar.externalId,
      calendarTitle: selectedCalendar.title,
      collectionId: selectedCalendar.collectionId,
      storageMode: selectedCalendar.storageMode,
      __mode: 'stub',
      deleted: false,
      changeState: 'active',
    },
  ];
}

function buildCalendarHeaders(input: {
  accessToken: string;
}): Record<string, string> {
  return {
    Authorization: `Bearer ${input.accessToken}`,
    Accept: 'application/json',
  };
}

async function listCalendarEvents(input: {
  accessToken: string;
  fetchImpl: typeof fetch;
  selectedCalendar: CalendarSelectedCalendar;
  syncToken?: string | null;
}): Promise<{
  rawObjects: CalendarEvent[];
  nextSyncToken: string | null;
}> {
  const rawObjects: CalendarEvent[] = [];
  let pageToken: string | null = null;
  let nextSyncToken: string | null =
    typeof input.syncToken === 'string' && input.syncToken.trim().length > 0
      ? input.syncToken
      : null;
  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.selectedCalendar.externalId)}/events`,
    );
    url.searchParams.set('maxResults', CALENDAR_QUERY_OPTIONS.maxResults);
    url.searchParams.set('showDeleted', CALENDAR_QUERY_OPTIONS.showDeleted);
    url.searchParams.set('singleEvents', CALENDAR_QUERY_OPTIONS.singleEvents);
    if (input.syncToken) {
      url.searchParams.set('syncToken', input.syncToken);
    }
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }
    const response = await input.fetchImpl(url.toString(), {
      headers: buildCalendarHeaders({ accessToken: input.accessToken }),
    });
    if (response.status === 410) {
      throw connectorCursorExpiredError({
        message: `Google Calendar sync token expired for ${input.selectedCalendar.externalId}; bounded selected-calendar resync required`,
        statusCode: 410,
      });
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw connectorRateLimitError({
          message: `Google Calendar events.list failed: HTTP ${response.status}`,
        });
      }
      throw new Error(`Google Calendar events.list failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as CalendarListResponse;
    for (const event of payload.items ?? []) {
      const rawObject = buildCalendarEventFromApi({
        event,
        selectedCalendar: input.selectedCalendar,
        mode: 'vault',
      });
      if (rawObject) {
        rawObjects.push(rawObject);
      }
    }
    nextSyncToken =
      typeof payload.nextSyncToken === 'string' && payload.nextSyncToken.trim().length > 0
        ? payload.nextSyncToken.trim()
        : nextSyncToken;
    pageToken =
      typeof payload.nextPageToken === 'string' && payload.nextPageToken.trim().length > 0
        ? payload.nextPageToken.trim()
        : null;
  } while (pageToken);
  return {
    rawObjects,
    nextSyncToken,
  };
}

function sortCalendarEvents(rawObjects: CalendarEvent[]) {
  rawObjects.sort((left, right) =>
    sanitizeObservedAt(right.updated ?? right.created).localeCompare(
      sanitizeObservedAt(left.updated ?? left.created),
    ),
  );
}

function calendarCursorForSelection(
  state: CalendarCursorState,
  selectedCalendar: CalendarSelectedCalendar,
): CalendarCursorEntry | null {
  return (
    state.calendarTokens.find(
      (entry) =>
        entry.calendarId === selectedCalendar.externalId &&
        entry.collectionId === selectedCalendar.collectionId,
    ) ?? null
  );
}

async function runSelectedCalendarInitialSync(input: {
  context: ConnectorSyncContext;
  accessToken: string | null;
  pullMode: 'stub' | 'vault';
  selectedCalendars: CalendarSelectedCalendar[];
  previousState: CalendarCursorState;
  reason: string;
}): Promise<ConnectorSyncPage<CalendarEvent>> {
  if (input.selectedCalendars.length === 0) {
    const observedAt = new Date().toISOString();
    const rawObjects = input.previousState.knownEvents.map((knownEvent) =>
      buildCalendarTombstone({
        calendarId: knownEvent.calendarId,
        calendarTitle: knownEvent.calendarTitle,
        collectionId: knownEvent.collectionId,
        eventId: knownEvent.eventId,
        title: knownEvent.title,
        observedAt,
        changeState: 'missing_from_selected_resync',
      }),
    );
    sortCalendarEvents(rawObjects);
    return {
      stream: CALENDAR_CURSOR_STREAM,
      mode: 'initial',
      rawObjects,
      pullMode: input.pullMode,
      note: input.reason,
      nextCursor: buildCalendarCursor({
        selectedCalendars: [],
        calendarTokens: [],
        knownEvents: [],
      }),
    };
  }

  if (input.pullMode === 'stub' || !input.accessToken) {
    const rawObjects = buildStubCalendarEvents({
      connectionId: input.context.account.connectionId,
      metadata: input.context.account.metadata,
    });
    const knownEvents = rawObjects
      .map((rawObject) => buildKnownCalendarEvent(rawObject))
      .filter((entry): entry is CalendarKnownEvent => entry !== null);
    return {
      stream: CALENDAR_CURSOR_STREAM,
      mode: 'initial',
      rawObjects,
      pullMode: 'stub',
      note: input.reason,
      nextCursor: buildCalendarCursor({
        selectedCalendars: input.selectedCalendars,
        calendarTokens: input.selectedCalendars.map((calendar) => ({
          calendarId: calendar.externalId,
          collectionId: calendar.collectionId,
          syncToken: null,
        })),
        knownEvents,
      }),
    };
  }

  const fetchImpl = input.context.fetchImpl ?? fetch;
  const previousKnownEvents = new Map<string, CalendarKnownEvent>(
    input.previousState.knownEvents.map((entry) => [
      buildCalendarKnownEventKey(entry.calendarId, entry.eventId),
      entry,
    ]),
  );
  const knownEvents = new Map<string, CalendarKnownEvent>();
  const activeKeys = new Set<string>();
  const tombstonedKeys = new Set<string>();
  const rawObjects: CalendarEvent[] = [];
  const calendarTokens: CalendarCursorEntry[] = [];

  for (const selectedCalendar of input.selectedCalendars) {
    const listed = await listCalendarEvents({
      accessToken: input.accessToken,
      fetchImpl,
      selectedCalendar,
    });
    calendarTokens.push({
      calendarId: selectedCalendar.externalId,
      collectionId: selectedCalendar.collectionId,
      syncToken: listed.nextSyncToken,
    });
    for (const rawObject of listed.rawObjects) {
      if (!rawObject.id) continue;
      const key = buildCalendarKnownEventKey(rawObject.calendarId, rawObject.id);
      if (rawObject.deleted) {
        const previousKnown = previousKnownEvents.get(key);
        if (!previousKnown) continue;
        rawObjects.push(
          buildCalendarTombstone({
            calendarId: previousKnown.calendarId,
            calendarTitle: previousKnown.calendarTitle,
            collectionId: previousKnown.collectionId,
            eventId: previousKnown.eventId,
            title: rawObject.summary ?? previousKnown.title,
            observedAt: sanitizeObservedAt(rawObject.updated ?? rawObject.created),
            changeState: 'cancelled',
            status: rawObject.status,
            created: rawObject.created,
            updated: rawObject.updated,
            start: rawObject.start,
            end: rawObject.end,
            description: rawObject.description,
            htmlLink: rawObject.htmlLink,
            location: rawObject.location,
            recurringEventId: rawObject.recurringEventId,
            originalStartTime: rawObject.originalStartTime,
            attendees: rawObject.attendees,
            organizer: rawObject.organizer,
            creator: rawObject.creator,
            iCalUID: rawObject.iCalUID,
            eventType: rawObject.eventType,
          }),
        );
        tombstonedKeys.add(key);
        continue;
      }
      rawObjects.push(rawObject);
      activeKeys.add(key);
      const knownEvent = buildKnownCalendarEvent(rawObject);
      if (knownEvent) {
        knownEvents.set(key, knownEvent);
      }
    }
  }

  const observedAt = new Date().toISOString();
  for (const previousKnown of input.previousState.knownEvents) {
    const key = buildCalendarKnownEventKey(previousKnown.calendarId, previousKnown.eventId);
    if (activeKeys.has(key) || tombstonedKeys.has(key)) continue;
    rawObjects.push(
      buildCalendarTombstone({
        calendarId: previousKnown.calendarId,
        calendarTitle: previousKnown.calendarTitle,
        collectionId: previousKnown.collectionId,
        eventId: previousKnown.eventId,
        title: previousKnown.title,
        observedAt,
        changeState: 'missing_from_selected_resync',
      }),
    );
  }

  sortCalendarEvents(rawObjects);
  return {
    stream: CALENDAR_CURSOR_STREAM,
    mode: 'initial',
    rawObjects,
    pullMode: 'vault',
    note: input.reason,
    nextCursor: buildCalendarCursor({
      selectedCalendars: input.selectedCalendars,
      calendarTokens,
      knownEvents: knownEvents.values(),
    }),
  };
}

async function syncGoogleCalendarEvents(
  context: ConnectorSyncContext,
  mode: 'initial' | 'incremental',
): Promise<ConnectorSyncPage<CalendarEvent>> {
  const selectedCalendars = resolveGoogleCalendarSelectedCalendars(context.account.metadata);
  const previousState = parseCalendarCursorState(context.cursor);
  if (selectedCalendars.length === 0) {
    return runSelectedCalendarInitialSync({
      context,
      accessToken: null,
      pullMode: 'stub',
      selectedCalendars,
      previousState,
      reason: 'Google Calendar selected-calendar sync skipped because no calendars are selected',
    });
  }

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
  const scopeKey = buildCalendarScopeKey(selectedCalendars);
  const queryKey = buildCalendarQueryKey();

  if (
    mode === 'initial' ||
    previousState.scopeKey !== scopeKey ||
    previousState.queryKey !== queryKey ||
    selectedCalendars.some((calendar) => !calendarCursorForSelection(previousState, calendar)?.syncToken)
  ) {
    return runSelectedCalendarInitialSync({
      context,
      accessToken: creds.mode === 'stub' ? null : creds.accessToken,
      pullMode: creds.mode === 'stub' ? 'stub' : 'vault',
      selectedCalendars,
      previousState,
      reason:
        creds.mode === 'stub'
          ? 'synthetic Google Calendar selected-calendar sync; vault credentials not read'
          : previousState.scopeKey && previousState.scopeKey !== scopeKey
            ? 'bounded Google Calendar selected-calendar resync after calendar selection change'
            : previousState.queryKey && previousState.queryKey !== queryKey
              ? 'bounded Google Calendar selected-calendar resync after query parameter change'
              : selectedCalendars.some(
                    (calendar) => !calendarCursorForSelection(previousState, calendar)?.syncToken,
                  )
                ? 'bounded Google Calendar selected-calendar resync after missing per-calendar sync token'
                : 'Google Calendar selected-calendar initial sync',
    });
  }

  if (creds.mode === 'stub') {
    return {
      stream: CALENDAR_CURSOR_STREAM,
      mode: 'incremental',
      rawObjects: [],
      pullMode: 'stub',
      note: 'synthetic Google Calendar incremental sync found no selected-calendar changes',
      nextCursor:
        context.cursor ??
        buildCalendarCursor({
          selectedCalendars,
          calendarTokens: previousState.calendarTokens,
          knownEvents: previousState.knownEvents,
        }),
    };
  }

  const fetchImpl = context.fetchImpl ?? fetch;
  const previousKnownEvents = new Map<string, CalendarKnownEvent>(
    previousState.knownEvents.map((entry) => [
      buildCalendarKnownEventKey(entry.calendarId, entry.eventId),
      entry,
    ]),
  );
  const nextKnownEvents = new Map(previousKnownEvents);
  const rawObjects: CalendarEvent[] = [];
  const nextCalendarTokens = new Map<string, CalendarCursorEntry>();
  for (const selectedCalendar of selectedCalendars) {
    const existingToken = calendarCursorForSelection(previousState, selectedCalendar)!;
    nextCalendarTokens.set(selectedCalendar.externalId, {
      calendarId: selectedCalendar.externalId,
      collectionId: selectedCalendar.collectionId,
      syncToken: existingToken.syncToken,
    });
  }

  try {
    for (const selectedCalendar of selectedCalendars) {
      const existingToken = calendarCursorForSelection(previousState, selectedCalendar);
      if (!existingToken?.syncToken) {
        return runSelectedCalendarInitialSync({
          context,
          accessToken: creds.accessToken,
          pullMode: 'vault',
          selectedCalendars,
          previousState,
          reason: 'bounded Google Calendar selected-calendar resync after missing per-calendar sync token',
        });
      }
      const listed = await listCalendarEvents({
        accessToken: creds.accessToken,
        fetchImpl,
        selectedCalendar,
        syncToken: existingToken.syncToken,
      });
      nextCalendarTokens.set(selectedCalendar.externalId, {
        calendarId: selectedCalendar.externalId,
        collectionId: selectedCalendar.collectionId,
        syncToken: listed.nextSyncToken ?? existingToken.syncToken,
      });
      for (const rawObject of listed.rawObjects) {
        if (!rawObject.id) continue;
        const key = buildCalendarKnownEventKey(rawObject.calendarId, rawObject.id);
        if (rawObject.deleted) {
          const previousKnown = previousKnownEvents.get(key);
          if (!previousKnown) continue;
          rawObjects.push(
            buildCalendarTombstone({
              calendarId: previousKnown.calendarId,
              calendarTitle: previousKnown.calendarTitle,
              collectionId: previousKnown.collectionId,
              eventId: previousKnown.eventId,
              title: rawObject.summary ?? previousKnown.title,
              observedAt: sanitizeObservedAt(rawObject.updated ?? rawObject.created),
              changeState: 'cancelled',
              status: rawObject.status,
              created: rawObject.created,
              updated: rawObject.updated,
              start: rawObject.start,
              end: rawObject.end,
              description: rawObject.description,
              htmlLink: rawObject.htmlLink,
              location: rawObject.location,
              recurringEventId: rawObject.recurringEventId,
              originalStartTime: rawObject.originalStartTime,
              attendees: rawObject.attendees,
              organizer: rawObject.organizer,
              creator: rawObject.creator,
              iCalUID: rawObject.iCalUID,
              eventType: rawObject.eventType,
            }),
          );
          nextKnownEvents.delete(key);
          continue;
        }
        rawObjects.push(rawObject);
        const knownEvent = buildKnownCalendarEvent(rawObject);
        if (knownEvent) {
          nextKnownEvents.set(key, knownEvent);
        }
      }
    }
  } catch (error) {
    const classified = classifyConnectorError(error);
    if (classified.kind !== 'cursor_expired') {
      throw error;
    }
    return runSelectedCalendarInitialSync({
      context,
      accessToken: creds.accessToken,
      pullMode: 'vault',
      selectedCalendars,
      previousState,
      reason: 'bounded Google Calendar selected-calendar resync after expired sync token',
    });
  }

  sortCalendarEvents(rawObjects);
  return {
    stream: CALENDAR_CURSOR_STREAM,
    mode: 'incremental',
    rawObjects,
    pullMode: 'vault',
    note:
      rawObjects.length > 0
        ? 'Google Calendar events.list incremental sync captured selected-calendar deltas'
        : 'Google Calendar events.list found no selected-calendar changes',
    nextCursor: buildCalendarCursor({
      selectedCalendars,
      calendarTokens: nextCalendarTokens.values(),
      knownEvents: nextKnownEvents.values(),
    }),
  };
}

async function checkpointCalendarEvents(input: {
  page: ConnectorSyncPage<CalendarEvent>;
  previousCursor: SyncCursor | null;
}): Promise<SyncCursor | null> {
  return input.page.nextCursor ?? input.previousCursor;
}

function formatCalendarAttendees(
  attendees: CalendarEventAttendee[] | undefined,
): Array<Record<string, string | boolean>> {
  return (attendees ?? []).flatMap((attendee) => {
    const entry: Record<string, string | boolean> = {};
    if (typeof attendee.email === 'string' && attendee.email.trim().length > 0) {
      entry.email = attendee.email.trim();
    }
    if (typeof attendee.displayName === 'string' && attendee.displayName.trim().length > 0) {
      entry.displayName = attendee.displayName.trim();
    }
    if (
      typeof attendee.responseStatus === 'string' &&
      attendee.responseStatus.trim().length > 0
    ) {
      entry.responseStatus = attendee.responseStatus.trim();
    }
    if (attendee.organizer === true) {
      entry.organizer = true;
    }
    if (attendee.self === true) {
      entry.self = true;
    }
    return Object.keys(entry).length > 0 ? [entry] : [];
  });
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
  const start = resolveCalendarInstant(input.event.start);
  const end = resolveCalendarInstant(input.event.end);
  const observedAt = sanitizeObservedAt(input.event.updated ?? input.event.created);
  const sourceMode = input.event.__mode ?? 'vault';
  const changeState = input.event.changeState ?? 'active';
  const eventVersion = input.event.deleted
    ? `${changeState}:${input.event.updated ?? observedAt}`
    : input.event.updated ?? input.event.created ?? observedAt;
  const envelopeIdempotencyKey = `connector-sync/${input.connectionId}/${externalId}/${eventVersion}`;
  const eventType = input.event.deleted
    ? `google-calendar.event.${changeState}`
    : 'google-calendar.event.updated';
  const attendees = formatCalendarAttendees(input.event.attendees);
  const note =
    sourceMode === 'stub'
      ? 'Synthetic Google Calendar selected-calendar sync (vault credentials not read).'
      : 'Source: vault-backed Google Calendar events.list selected-calendar metadata sync.';
  const object: ExternalObject = {
    provider: 'google-calendar',
    accountId: input.connectionId,
    collectionId: input.event.collectionId,
    externalId,
    externalVersion: eventVersion,
    objectType: 'calendar_event',
    title: summary,
    createdAt: observedAt,
    modifiedAt: observedAt,
    deleted: input.event.deleted,
    attachments: [],
    permissionsSnapshot: input.event.deleted
      ? {
          reason:
            changeState === 'cancelled'
              ? 'calendar event cancelled or deleted at source'
              : 'calendar event missing from selected-calendar bounded resync',
        }
      : {},
    metadata: {
      calendarId: input.event.calendarId,
      calendarTitle: input.event.calendarTitle,
      status: input.event.status ?? 'confirmed',
      start,
      end,
      description: input.event.description ?? null,
      location: input.event.location ?? null,
      htmlLink: input.event.htmlLink ?? null,
      attendees,
      recurringEventId: input.event.recurringEventId ?? null,
      originalStartTime: input.event.originalStartTime ?? null,
      organizer: input.event.organizer ?? null,
      creator: input.event.creator ?? null,
      iCalUID: input.event.iCalUID ?? null,
      eventType: input.event.eventType ?? null,
      changeState,
      sourceMode,
    },
  };

  return {
    externalObject: object,
    envelope: {
      schema_version: '1.0',
      workspace_id: input.workspaceId,
      source: {
        provider: 'google-calendar',
        account_id: input.connectionId,
        external_id: externalId,
        external_version: eventVersion,
      },
      event_type: eventType,
      observed_at: observedAt,
      idempotency_key: envelopeIdempotencyKey,
      content: {
        mime_type: 'text/plain',
        text: `${label}: ${summary}`,
      },
      scope: {
        sensitivity: 'personal',
        storage_mode: CALENDAR_STORAGE_MODE,
      },
      provenance: {
        status: input.event.status ?? 'confirmed',
        sourceMode,
        changeState,
        calendarId: input.event.calendarId,
        collectionId: input.event.collectionId,
      },
    },
    capture: {
      title: `${label}: ${summary}`,
      text: [
        `Connector: Google Calendar (${sourceMode})`,
        `Calendar: ${input.event.calendarTitle}`,
        `Event: ${summary}`,
        `Status: ${input.event.status ?? 'confirmed'}`,
        `Start: ${start}`,
        `End: ${end}`,
        attendees.length > 0 ? `Attendees: ${JSON.stringify(attendees)}` : null,
        input.event.location ? `Location: ${input.event.location}` : null,
        input.event.description ? `Description: ${input.event.description}` : null,
        input.event.recurringEventId
          ? `Recurring master: ${input.event.recurringEventId}`
          : null,
        input.event.originalStartTime
          ? `Original start: ${resolveCalendarInstant(input.event.originalStartTime)}`
          : null,
        note,
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n'),
      filename: `google-calendar://${externalId}`,
      mimeType: 'text/plain',
      idempotencyKey: envelopeIdempotencyKey,
    },
  };
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
  const selectedCalendars = resolveGoogleCalendarSelectedCalendars(context.account.metadata);
  if (selectedCalendars.length === 0) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-calendar',
      status: 'degraded',
      note: 'Google Calendar requires at least one selected calendar before sync can run',
      vaultRef,
      checks: [
        {
          name: 'selected_calendars',
          status: 'warn',
          detail: 'No selected calendars are configured for this connection.',
        },
      ],
    });
  }

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

  const probeCalendar = selectedCalendars[0]!;
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(probeCalendar.externalId)}/events`,
  );
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('singleEvents', 'true');
  const response = await (context.fetchImpl ?? fetch)(url.toString(), {
    headers: buildCalendarHeaders({ accessToken: creds.accessToken }),
  });

  if (response.ok) {
    return buildConnectionHealthReport({
      connectionId: context.account.connectionId,
      connectorId: 'google-calendar',
      status: 'healthy',
      note: 'Google Calendar OAuth token is valid and the selected-calendar probe succeeded',
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
          detail: `Google Calendar selected-calendar probe returned HTTP 200 for ${probeCalendar.externalId}.`,
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
          detail: `Google Calendar selected-calendar probe returned HTTP ${response.status}.`,
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
        detail: `Google Calendar selected-calendar probe returned HTTP ${response.status}.`,
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
    storage_modes: ['reference'],
    rate_limit_strategy: 'provider_headers',
    data_classes: ['personal'],
  },
  lifecycle: {
    async validateScope(context) {
      return validateGoogleCalendarSelectionScope(context.account.metadata);
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
  certification: {
    buildReplayContext({ baseContext }) {
      return {
        ...baseContext,
        cursor: null,
      };
    },
    buildResyncContext({ baseContext }) {
      return {
        ...baseContext,
        cursor: null,
      };
    },
    buildCursorExpiredContext({ baseContext, initialRun }) {
      const state = parseCalendarCursorState(initialRun.nextCursor);
      return {
        ...baseContext,
        cursor: buildDefaultCursor(
          CALENDAR_CURSOR_STREAM,
          {
            ...state,
            scopeKey: buildCalendarScopeKey(
              resolveGoogleCalendarSelectedCalendars(baseContext.account.metadata),
            ),
            queryKey: buildCalendarQueryKey(),
            calendarTokens: state.calendarTokens.map((entry) => ({
              ...entry,
              syncToken: 'expired-sync-token',
            })),
          },
          CALENDAR_CURSOR_SCHEMA_VERSION,
        ),
      };
    },
    buildRevokeContext(context) {
      return {
        ...context,
        account: {
          ...context.account,
          vaultRef: context.account.vaultRef ?? 'vault:test/google-calendar',
        },
      };
    },
  },
};

/** Stub Calendar delta: invents selected-calendar event metadata from connection scope only. */
export function pullGoogleCalendarStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  metadata?: Record<string, unknown>;
}): CalendarPullResult {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'google-calendar',
      accountId: input.connectionId,
    });
  const rawObjects = buildStubCalendarEvents({
    connectionId: input.connectionId,
    metadata: input.metadata,
  });
  const items = rawObjects.map((event) => {
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
  const selectedCalendars = resolveGoogleCalendarSelectedCalendars(input.metadata);
  const knownEvents = rawObjects
    .map((rawObject) => buildKnownCalendarEvent(rawObject))
    .filter((entry): entry is CalendarKnownEvent => entry !== null);

  return {
    vaultRef,
    mode: 'stub',
    note: 'synthetic Google Calendar selected-calendar sync; vault credentials not read',
    items,
    nextCursor:
      selectedCalendars.length === 0 && knownEvents.length === 0
        ? null
        : buildCalendarCursor({
            selectedCalendars,
            calendarTokens: selectedCalendars.map((calendar) => ({
              calendarId: calendar.externalId,
              collectionId: calendar.collectionId,
              syncToken: null,
            })),
            knownEvents,
          }),
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
  metadata?: Record<string, unknown>;
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
        metadata: input.metadata,
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

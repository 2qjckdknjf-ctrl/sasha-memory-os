import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildDefaultCursor,
  createLocalVaultStore,
  runConnectorCertificationSmoke,
  runConnectorSync,
} from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  googleCalendarConnector,
  pullGoogleCalendarStubDelta,
  resolveGoogleCalendarSelectedCalendars,
  validateGoogleCalendarSelectionScope,
} from './sync.js';

const connectionId = '88888888-8888-4888-8888-888888888804';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const vaultRef = `vault:local/connectors/google-calendar/${connectionId}`;

const selectedCalendarMetadata = {
  collections: {
    selection_mode: 'selected' as const,
    excluded_ids: ['google-calendar:calendar:cal-hidden'],
    items: [
      {
        id: 'google-calendar:calendar:cal-personal',
        external_id: 'cal-personal',
        kind: 'calendar' as const,
        name: 'Personal Calendar',
        title: 'Personal Calendar',
        metadata: {},
      },
      {
        id: 'google-calendar:calendar:cal-team',
        external_id: 'cal-team',
        kind: 'calendar' as const,
        name: 'Team Calendar',
        title: 'Team Calendar',
        metadata: {},
      },
      {
        id: 'google-calendar:calendar:cal-hidden',
        external_id: 'cal-hidden',
        kind: 'calendar' as const,
        name: 'Hidden Calendar',
        title: 'Hidden Calendar',
        metadata: {},
      },
    ],
    project_bindings: {
      'google-calendar:calendar:cal-personal': '44444444-4444-4444-8444-444444444431',
      'google-calendar:calendar:cal-team': '44444444-4444-4444-8444-444444444432',
    },
  },
};

function createCalendarProcessEnv(dir: string) {
  return {
    MEMORY_OS_ENV: 'local',
    MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
    MEMORY_OS_VAULT_DIR: dir,
    MEMORY_OS_VAULT_KEY: 'test-vault-key',
  };
}

async function createCalendarVaultFixture(dir: string) {
  const processEnv = createCalendarProcessEnv(dir);
  const vault = createLocalVaultStore(processEnv);
  await vault.put({
    vaultRef,
    accessToken: 'ya29.cal',
    provider: 'google-calendar',
    storedAt: '2026-08-11T12:00:00.000Z',
  });
  return {
    processEnv,
    vault,
  };
}

function selectedCalendarScopeKey(): string {
  return resolveGoogleCalendarSelectedCalendars(selectedCalendarMetadata)
    .map((calendar) => `${calendar.collectionId}:${calendar.externalId}:${calendar.storageMode}`)
    .sort()
    .join('|');
}

function buildSelectedCalendarCursor(input?: {
  calendarTokens?: Array<{
    calendarId: string;
    collectionId: string;
    syncToken: string | null;
  }>;
  knownEvents?: Array<{
    calendarId: string;
    calendarTitle: string;
    collectionId: string;
    eventId: string;
    title: string | null;
    storageMode: 'reference';
  }>;
}) {
  const selectedCalendars = resolveGoogleCalendarSelectedCalendars(selectedCalendarMetadata);
  return buildDefaultCursor(
    'google-calendar:events',
    {
      scopeKey: selectedCalendarScopeKey(),
      queryKey: 'maxResults=250&showDeleted=true&singleEvents=true',
      calendarTokens:
        input?.calendarTokens ??
        selectedCalendars.map((calendar) => ({
          calendarId: calendar.externalId,
          collectionId: calendar.collectionId,
          syncToken: `${calendar.externalId}-sync-1`,
        })),
      knownEvents: input?.knownEvents ?? [],
    },
    '2.0',
  );
}

function calendarEvent(input: {
  id: string;
  summary: string;
  updated: string;
  status?: string;
  description?: string;
  location?: string;
  recurringEventId?: string;
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
}) {
  return {
    id: input.id,
    summary: input.summary,
    status: input.status ?? 'confirmed',
    updated: input.updated,
    start: { dateTime: '2026-08-12T10:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2026-08-12T10:30:00.000Z', timeZone: 'UTC' },
    description: input.description,
    location: input.location,
    recurringEventId: input.recurringEventId,
    attendees: input.attendees,
  };
}

describe('google calendar selected-calendar contract', () => {
  it('requires an explicit selected-calendar scope and does not invent the old standup stub', () => {
    expect(validateGoogleCalendarSelectionScope({})).toEqual({
      ok: false,
      missing: ['metadata.collections'],
    });
    expect(
      validateGoogleCalendarSelectionScope({
        collections: {
          selection_mode: 'selected',
          excluded_ids: [],
          items: [],
        },
      }),
    ).toEqual({
      ok: false,
      missing: ['selected Google Calendar calendars'],
    });
    expect(resolveGoogleCalendarSelectedCalendars(selectedCalendarMetadata)).toEqual([
      expect.objectContaining({
        collectionId: 'google-calendar:calendar:cal-personal',
        externalId: 'cal-personal',
        storageMode: 'reference',
      }),
      expect.objectContaining({
        collectionId: 'google-calendar:calendar:cal-team',
        externalId: 'cal-team',
        storageMode: 'reference',
      }),
    ]);

    const result = pullGoogleCalendarStubDelta({
      connectionId,
      displayName: 'Pilot Calendar',
      metadata: selectedCalendarMetadata,
    });
    expect(result.mode).toBe('stub');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toMatch(/synthetic selected-calendar event/i);
    expect(JSON.stringify(result)).not.toMatch(/AISTROYKA/i);
  });

  it('produces no crawl when no calendars are selected', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-empty-'));
    try {
      const { processEnv, vault } = await createCalendarVaultFixture(dir);
      const fetchImpl = vi.fn(async () => {
        throw new Error('fetch should not be called when no calendars are selected');
      });
      const syncRun = await runConnectorSync({
        connector: googleCalendarConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-calendar',
            displayName: 'Pilot Calendar',
            vaultRef,
            scopes: ['calendar.readonly'],
            metadata: {
              collections: {
                selection_mode: 'selected',
                excluded_ids: [],
                items: [],
                project_bindings: {},
              },
            },
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(syncRun.records).toHaveLength(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncs selected calendars only, ignores unselected siblings, and uses personal reference storage', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-selected-'));
    try {
      const { processEnv, vault } = await createCalendarVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/calendars/cal-personal/events')) {
          return Response.json({
            items: [
              calendarEvent({
                id: 'evt-shared',
                summary: 'Shared personal event',
                updated: '2026-08-11T09:00:00.000Z',
                description: 'Personal description',
              }),
              calendarEvent({
                id: 'evt-personal-only',
                summary: 'Personal only event',
                updated: '2026-08-11T09:05:00.000Z',
              }),
            ],
            nextSyncToken: 'cal-personal-sync-1',
          });
        }
        if (parsed.pathname.endsWith('/calendars/cal-team/events')) {
          return Response.json({
            items: [
              calendarEvent({
                id: 'evt-shared',
                summary: 'Shared team event',
                updated: '2026-08-11T09:10:00.000Z',
                attendees: [{ email: 'teammate@example.com', responseStatus: 'accepted' }],
              }),
            ],
            nextSyncToken: 'cal-team-sync-1',
          });
        }
        throw new Error(`Unhandled Google Calendar test URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: googleCalendarConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-calendar',
            displayName: 'Pilot Calendar',
            vaultRef,
            scopes: ['calendar.readonly'],
            metadata: selectedCalendarMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      const byExternalId = new Map(
        syncRun.records.map((record) => [record.externalObject.externalId, record]),
      );
      expect(syncRun.page.mode).toBe('initial');
      expect(syncRun.records).toHaveLength(3);
      expect(byExternalId.has('calendar/cal-personal/event/evt-shared')).toBe(true);
      expect(byExternalId.has('calendar/cal-team/event/evt-shared')).toBe(true);
      expect(byExternalId.get('calendar/cal-personal/event/evt-shared')?.externalObject.collectionId).toBe(
        'google-calendar:calendar:cal-personal',
      );
      expect(byExternalId.get('calendar/cal-team/event/evt-shared')?.externalObject.collectionId).toBe(
        'google-calendar:calendar:cal-team',
      );
      expect(byExternalId.get('calendar/cal-personal/event/evt-shared')?.envelope.scope.storage_mode).toBe(
        'reference',
      );
      expect(byExternalId.get('calendar/cal-team/event/evt-shared')?.envelope.scope.sensitivity).toBe(
        'personal',
      );
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('/calendars/primary/')),
      ).toBe(false);
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('/calendars/cal-hidden/')),
      ).toBe(false);
      expect(syncRun.nextCursor?.opaque.calendarTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            calendarId: 'cal-personal',
            syncToken: 'cal-personal-sync-1',
          }),
          expect.objectContaining({
            calendarId: 'cal-team',
            syncToken: 'cal-team-sync-1',
          }),
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses per-calendar sync tokens for incremental sync and tombstones cancelled events', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-incremental-'));
    try {
      const { processEnv, vault } = await createCalendarVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/calendars/cal-personal/events')) {
          return Response.json({
            items: [
              calendarEvent({
                id: 'evt-personal-new',
                summary: 'Personal delta',
                updated: '2026-08-11T10:00:00.000Z',
              }),
            ],
            nextSyncToken: 'cal-personal-sync-2',
          });
        }
        if (parsed.pathname.endsWith('/calendars/cal-team/events')) {
          return Response.json({
            items: [
              calendarEvent({
                id: 'evt-team-old',
                summary: 'Cancelled team event',
                updated: '2026-08-11T10:05:00.000Z',
                status: 'cancelled',
              }),
            ],
            nextSyncToken: 'cal-team-sync-2',
          });
        }
        throw new Error(`Unhandled incremental Google Calendar URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: googleCalendarConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-calendar',
            displayName: 'Pilot Calendar',
            vaultRef,
            scopes: ['calendar.readonly'],
            metadata: selectedCalendarMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildSelectedCalendarCursor({
            calendarTokens: [
              {
                calendarId: 'cal-personal',
                collectionId: 'google-calendar:calendar:cal-personal',
                syncToken: 'cal-personal-sync-1',
              },
              {
                calendarId: 'cal-team',
                collectionId: 'google-calendar:calendar:cal-team',
                syncToken: 'cal-team-sync-1',
              },
            ],
            knownEvents: [
              {
                calendarId: 'cal-team',
                calendarTitle: 'Team Calendar',
                collectionId: 'google-calendar:calendar:cal-team',
                eventId: 'evt-team-old',
                title: 'Cancelled team event',
                storageMode: 'reference',
              },
            ],
          }),
        },
      });

      const byExternalId = new Map(
        syncRun.records.map((record) => [record.externalObject.externalId, record]),
      );
      expect(syncRun.page.mode).toBe('incremental');
      expect(byExternalId.get('calendar/cal-personal/event/evt-personal-new')?.externalObject.deleted).toBe(
        false,
      );
      expect(byExternalId.get('calendar/cal-team/event/evt-team-old')?.externalObject.deleted).toBe(
        true,
      );
      expect(byExternalId.get('calendar/cal-team/event/evt-team-old')?.envelope.event_type).toBe(
        'google-calendar.event.cancelled',
      );
      const requestUrls = fetchImpl.mock.calls.map(([value]) => new URL(String(value)));
      const personalUrl = requestUrls.find((url) =>
        url.pathname.endsWith('/calendars/cal-personal/events'),
      );
      const teamUrl = requestUrls.find((url) => url.pathname.endsWith('/calendars/cal-team/events'));
      expect(personalUrl?.searchParams.get('syncToken')).toBe('cal-personal-sync-1');
      expect(teamUrl?.searchParams.get('syncToken')).toBe('cal-team-sync-1');
      expect(personalUrl?.searchParams.get('maxResults')).toBe('250');
      expect(personalUrl?.searchParams.get('showDeleted')).toBe('true');
      expect(personalUrl?.searchParams.get('singleEvents')).toBe('true');
      expect(personalUrl?.searchParams.has('timeMin')).toBe(false);
      expect(personalUrl?.searchParams.has('orderBy')).toBe(false);
      expect(syncRun.nextCursor?.opaque.calendarTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            calendarId: 'cal-personal',
            syncToken: 'cal-personal-sync-2',
          }),
          expect.objectContaining({
            calendarId: 'cal-team',
            syncToken: 'cal-team-sync-2',
          }),
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs a bounded selected-calendar resync on 410 and tombstones events that leave the projection', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-expired-'));
    try {
      const { processEnv, vault } = await createCalendarVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (
          parsed.pathname.endsWith('/calendars/cal-personal/events') &&
          parsed.searchParams.get('syncToken')
        ) {
          return new Response('expired', { status: 410 });
        }
        if (parsed.pathname.endsWith('/calendars/cal-personal/events')) {
          return Response.json({
            items: [
              calendarEvent({
                id: 'evt-personal-fresh',
                summary: 'Fresh after bounded resync',
                updated: '2026-08-11T11:00:00.000Z',
              }),
            ],
            nextSyncToken: 'cal-personal-sync-2',
          });
        }
        if (
          parsed.pathname.endsWith('/calendars/cal-team/events') &&
          parsed.searchParams.get('syncToken')
        ) {
          throw new Error('team incremental call should not run after the first 410 forces bounded resync');
        }
        if (parsed.pathname.endsWith('/calendars/cal-team/events')) {
          return Response.json({
            items: [],
            nextSyncToken: 'cal-team-sync-2',
          });
        }
        throw new Error(`Unhandled expired-sync Google Calendar URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: googleCalendarConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-calendar',
            displayName: 'Pilot Calendar',
            vaultRef,
            scopes: ['calendar.readonly'],
            metadata: selectedCalendarMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildSelectedCalendarCursor({
            calendarTokens: [
              {
                calendarId: 'cal-personal',
                collectionId: 'google-calendar:calendar:cal-personal',
                syncToken: 'expired-sync-token',
              },
              {
                calendarId: 'cal-team',
                collectionId: 'google-calendar:calendar:cal-team',
                syncToken: 'cal-team-sync-1',
              },
            ],
            knownEvents: [
              {
                calendarId: 'cal-personal',
                calendarTitle: 'Personal Calendar',
                collectionId: 'google-calendar:calendar:cal-personal',
                eventId: 'evt-personal-old',
                title: 'Old personal event',
                storageMode: 'reference',
              },
              {
                calendarId: 'cal-team',
                calendarTitle: 'Team Calendar',
                collectionId: 'google-calendar:calendar:cal-team',
                eventId: 'evt-team-old',
                title: 'Old team event',
                storageMode: 'reference',
              },
            ],
          }),
        },
      });

      expect(syncRun.page.mode).toBe('initial');
      expect(syncRun.page.note).toMatch(/expired sync token/i);
      expect(
        syncRun.records.some(
          (record) =>
            record.envelope.event_type === 'google-calendar.event.missing_from_selected_resync',
        ),
      ).toBe(true);
      expect(syncRun.records.some((record) => record.externalObject.deleted)).toBe(true);
      expect(syncRun.nextCursor?.opaque.calendarTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            calendarId: 'cal-personal',
            syncToken: 'cal-personal-sync-2',
          }),
          expect.objectContaining({
            calendarId: 'cal-team',
            syncToken: 'cal-team-sync-2',
          }),
        ]),
      );
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('/calendars/cal-hidden/')),
      ).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('googleCalendarConnector certification', () => {
  it('passes SDK certification smoke with selected calendars and sync token recovery', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-cal-cert-'));
    try {
      const { processEnv, vault } = await createCalendarVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (
          parsed.pathname.endsWith('/calendars/cal-personal/events') &&
          parsed.searchParams.get('maxResults') === '1' &&
          !parsed.searchParams.get('showDeleted')
        ) {
          return Response.json({ items: [] });
        }
        if (parsed.pathname.endsWith('/calendars/cal-personal/events')) {
          const syncToken = parsed.searchParams.get('syncToken');
          if (syncToken === 'expired-sync-token') {
            return new Response('expired', { status: 410 });
          }
          if (syncToken) {
            return Response.json({
              items: [],
              nextSyncToken: 'cal-personal-sync-2',
            });
          }
          return Response.json({
            items: [
              calendarEvent({
                id: 'cert-personal',
                summary: 'Certification personal event',
                updated: '2026-08-11T12:00:00.000Z',
              }),
            ],
            nextSyncToken: 'cal-personal-sync-1',
          });
        }
        if (parsed.pathname.endsWith('/calendars/cal-team/events')) {
          const syncToken = parsed.searchParams.get('syncToken');
          if (syncToken) {
            return Response.json({
              items: [],
              nextSyncToken: 'cal-team-sync-2',
            });
          }
          return Response.json({
            items: [
              calendarEvent({
                id: 'cert-team',
                summary: 'Certification team event',
                updated: '2026-08-11T12:05:00.000Z',
              }),
            ],
            nextSyncToken: 'cal-team-sync-1',
          });
        }
        throw new Error(`Unhandled certification Google Calendar URL: ${url}`);
      });

      const result = await runConnectorCertificationSmoke({
        connector: googleCalendarConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-calendar',
            displayName: 'Calendar pilot',
            vaultRef,
            scopes: ['calendar.readonly'],
            metadata: selectedCalendarMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(result.records).toHaveLength(2);
      expect(result.nextCursor?.opaque.calendarTokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            calendarId: 'cal-personal',
            syncToken: 'cal-personal-sync-1',
          }),
          expect.objectContaining({
            calendarId: 'cal-team',
            syncToken: 'cal-team-sync-1',
          }),
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

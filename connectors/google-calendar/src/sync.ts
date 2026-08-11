import { vaultRefForAccount } from '@memory-os/connector-sdk';

export type CalendarSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

/** Stub Calendar delta: invents event metadata from vault ref only. */
export function pullGoogleCalendarStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): { vaultRef: string; items: CalendarSyncDelta[] } {
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

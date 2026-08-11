import { vaultRefForAccount } from '@memory-os/connector-sdk';

export type GmailSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

/** Stub Gmail delta: invents metadata-only message events from vault ref. */
export function pullGmailStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): { vaultRef: string; items: GmailSyncDelta[] } {
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

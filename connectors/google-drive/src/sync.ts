import { vaultRefForAccount } from '@memory-os/connector-sdk';

export type DriveSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

/** Stub Drive delta: invents file change events from vault ref only. */
export function pullGoogleDriveStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): { vaultRef: string; items: DriveSyncDelta[] } {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'google-drive',
      accountId: input.connectionId,
    });
  const label = input.displayName ?? 'Google Drive';
  const stamp = new Date().toISOString();

  return {
    vaultRef,
    items: [
      {
        externalId: `file/${input.connectionId.slice(0, 8)}/brief`,
        eventType: 'drive.file.updated',
        title: `${label}: Project brief.docx updated`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic Google Drive sync (credentials not read).',
          'File Project brief.docx changed in folder AISTROYKA.',
        ].join('\n'),
        observedAt: stamp,
      },
    ],
  };
}

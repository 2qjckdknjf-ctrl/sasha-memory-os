import {
  resolvePullCredentials,
  vaultRefForAccount,
  type VaultStore,
} from '@memory-os/connector-sdk';

export type DriveSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

export type DrivePullResult = {
  vaultRef: string;
  mode: 'stub' | 'vault';
  note: string;
  items: DriveSyncDelta[];
};

type DriveListResponse = {
  files?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    parents?: string[];
  }>;
};

/** Stub Drive delta: invents file change events from vault ref only. */
export function pullGoogleDriveStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): DrivePullResult {
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
    mode: 'stub',
    note: 'synthetic Google Drive sync; vault credentials not read',
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

async function pullGoogleDriveVaultDelta(input: {
  connectionId: string;
  displayName?: string;
  vaultRef: string;
  accessToken: string;
  fetchImpl: typeof fetch;
}): Promise<DrivePullResult> {
  const label = input.displayName ?? 'Google Drive';
  const url =
    'https://www.googleapis.com/drive/v3/files?pageSize=5&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,parents)';
  const response = await input.fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Google Drive files API failed: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as DriveListResponse;
  const files = payload.files ?? [];
  const items: DriveSyncDelta[] = files
    .filter((file) => file.id && file.name)
    .map((file) => ({
      externalId: `file/${file.id}`,
      eventType: 'drive.file.updated',
      title: `${label}: ${file.name}`,
      text: [
        `Connector vault ref: ${input.vaultRef}`,
        `File ${file.name} (${file.mimeType ?? 'unknown'})`,
        file.modifiedTime ? `Modified: ${file.modifiedTime}` : 'Modified: unknown',
        'Source: vault-backed Google Drive files.list.',
      ].join('\n'),
      observedAt: file.modifiedTime ?? new Date().toISOString(),
    }));

  if (items.length === 0) {
    items.push({
      externalId: `file/${input.connectionId.slice(0, 8)}/empty`,
      eventType: 'drive.file.empty',
      title: `${label}: no recent files`,
      text: [
        `Connector vault ref: ${input.vaultRef}`,
        'Vault-backed Drive pull succeeded but returned no files.',
      ].join('\n'),
      observedAt: new Date().toISOString(),
    });
  }

  return {
    vaultRef: input.vaultRef,
    mode: 'vault',
    note: 'vault-backed Google Drive files ingested',
    items,
  };
}

/** Pull Drive deltas: vault-backed when token exists (auto/vault), else stub. */
export async function pullGoogleDriveDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
  processEnv?: NodeJS.ProcessEnv;
  vault?: VaultStore;
  fetchImpl?: typeof fetch;
}): Promise<DrivePullResult> {
  const processEnv = input.processEnv ?? process.env;
  const envName = input.env ?? processEnv.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env: envName,
      connectorId: 'google-drive',
      accountId: input.connectionId,
    });
  const stub = () =>
    pullGoogleDriveStubDelta({
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

  return pullGoogleDriveVaultDelta({
    connectionId: input.connectionId,
    displayName: input.displayName,
    vaultRef,
    accessToken: creds.accessToken,
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

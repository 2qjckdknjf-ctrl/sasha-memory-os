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
import XLSX from 'xlsx';
import {
  driveFileWithinSelectedScope,
  googleDriveConnector,
  pullGoogleDriveDelta,
  pullGoogleDriveStubDelta,
  validateGoogleDriveSelectionScope,
} from './sync.js';

const connectionId = '88888888-8888-4888-8888-888888888803';
const selectedDriveMetadata = {
  collections: {
    selection_mode: 'selected' as const,
    excluded_ids: [],
    items: [
      {
        id: 'google-drive:file:FILE-1',
        external_id: 'FILE-1',
        kind: 'file' as const,
        name: 'Roadmap.md',
        title: 'Roadmap.md',
        metadata: {
          storage_mode: 'indexed',
        },
      },
      {
        id: 'google-drive:folder:FOLDER-1',
        external_id: 'FOLDER-1',
        kind: 'folder' as const,
        name: 'Specs',
        title: 'Specs',
        metadata: {
          storage_mode: 'reference',
        },
      },
    ],
    project_bindings: {
      'google-drive:file:FILE-1': '44444444-4444-4444-8444-444444444421',
      'google-drive:folder:FOLDER-1': '44444444-4444-4444-8444-444444444422',
    },
  },
};

function createDriveProcessEnv(dir: string) {
  return {
    MEMORY_OS_ENV: 'local',
    MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
    MEMORY_OS_VAULT_DIR: dir,
    MEMORY_OS_VAULT_KEY: 'test-vault-key',
  };
}

async function createDriveVaultFixture(dir: string) {
  const processEnv = createDriveProcessEnv(dir);
  const vault = createLocalVaultStore(processEnv);
  const vaultRef = `vault:local/connectors/google-drive/${connectionId}`;
  await vault.put({
    vaultRef,
    accessToken: 'ya29.drive',
    provider: 'google-drive',
    storedAt: '2026-08-11T12:00:00.000Z',
  });
  return {
    processEnv,
    vault,
    vaultRef,
  };
}

function drivePermissionResponse(options?: {
  shared?: boolean;
  permissions?: Array<Record<string, unknown>>;
}) {
  return Response.json({
    shared: options?.shared ?? true,
    permissions: options?.permissions ?? [
      {
        id: 'perm-owner',
        type: 'user',
        role: 'writer',
        emailAddress: 'owner@example.com',
      },
    ],
  });
}

function appendDrivePermissionResponses(fetchImpl: ReturnType<typeof vi.fn>, count: number) {
  for (let index = 0; index < count; index += 1) {
    fetchImpl.mockResolvedValueOnce(drivePermissionResponse());
  }
  return fetchImpl;
}

function createWorkbookBuffer(sheets: Record<string, string[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}

function driveFetchFixtureSequence() {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ startPageToken: 'drive-token-1' }))
    .mockResolvedValueOnce(
      Response.json({
        id: 'FILE-1',
        name: 'Roadmap.md',
        mimeType: 'text/markdown',
        modifiedTime: '2026-08-11T10:00:00.000Z',
        parents: ['ROOT'],
      }),
    )
    .mockResolvedValueOnce(
      drivePermissionResponse(),
    )
    .mockResolvedValueOnce(
      Response.json({
        files: [
          {
            id: 'CHILD-1',
            name: 'Architecture.md',
            mimeType: 'text/markdown',
            modifiedTime: '2026-08-11T09:00:00.000Z',
            parents: ['FOLDER-1'],
          },
        ],
      }),
    );
  return appendDrivePermissionResponses(fetchImpl, 1);
}

function appendDriveInitialSyncResponses(fetchImpl: ReturnType<typeof vi.fn>) {
  fetchImpl
    .mockResolvedValueOnce(Response.json({ startPageToken: 'drive-token-1' }))
    .mockResolvedValueOnce(
      Response.json({
        id: 'FILE-1',
        name: 'Roadmap.md',
        mimeType: 'text/markdown',
        modifiedTime: '2026-08-11T10:00:00.000Z',
        parents: ['ROOT'],
      }),
    )
    .mockResolvedValueOnce(
      drivePermissionResponse(),
    )
    .mockResolvedValueOnce(
      Response.json({
        files: [
          {
            id: 'CHILD-1',
            name: 'Architecture.md',
            mimeType: 'text/markdown',
            modifiedTime: '2026-08-11T09:00:00.000Z',
            parents: ['FOLDER-1'],
          },
        ],
      }),
    );
  return appendDrivePermissionResponses(fetchImpl, 1);
}

describe('pullGoogleDriveDelta', () => {
  it('validates a selected file/folder scope and allows only descendants of selected folders', () => {
    expect(validateGoogleDriveSelectionScope(selectedDriveMetadata)).toEqual({
      ok: true,
      missing: [],
    });
    expect(
      driveFileWithinSelectedScope({
        file: {
          id: 'CHILD-1',
          parents: ['FOLDER-1'],
        },
        metadata: selectedDriveMetadata,
      }),
    ).toBe(true);
    expect(
      driveFileWithinSelectedScope({
        file: {
          id: 'SIBLING-1',
          parents: ['UNSELECTED-FOLDER'],
        },
        metadata: selectedDriveMetadata,
      }),
    ).toBe(false);
  });

  it('returns stub file event without tokens', () => {
    const result = pullGoogleDriveStubDelta({
      connectionId,
      metadata: selectedDriveMetadata,
    });
    expect(result.mode).toBe('stub');
    expect(result.items[0]?.title).toMatch(/Roadmap|Specs/i);
  });

  it('uses vault-backed selected Drive files/folders and stores a change token cursor', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-'));
    try {
      const { processEnv, vault } = await createDriveVaultFixture(dir);
      const fetchImpl = driveFetchFixtureSequence();
      const result = await pullGoogleDriveDelta({
        connectionId,
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        metadata: selectedDriveMetadata,
      });
      expect(result.mode).toBe('vault');
      expect(result.items.map((item) => item.title)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Roadmap\.md/),
          expect.stringMatching(/Architecture\.md/),
        ]),
      );
      expect(JSON.stringify(result)).not.toContain('ya29.drive');
      expect(result.nextCursor?.stream).toBe('google-drive:files');
      expect(result.nextCursor?.opaque.startPageToken).toBe('drive-token-1');
      expect(result.nextCursor?.opaque.knownFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'FILE-1' }),
          expect.objectContaining({ id: 'CHILD-1' }),
        ]),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses changes.list and rejects a sibling outside the selected folder scope', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-cursor-'));
    try {
      const { processEnv, vault } = await createDriveVaultFixture(dir);
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            changes: [
              {
                fileId: 'CHILD-2',
                time: '2026-08-11T11:30:00.000Z',
                file: {
                  id: 'CHILD-2',
                  name: 'Spec update.md',
                  mimeType: 'text/markdown',
                  modifiedTime: '2026-08-11T11:30:00.000Z',
                  parents: ['FOLDER-1'],
                },
              },
              {
                fileId: 'SIBLING-1',
                time: '2026-08-11T11:40:00.000Z',
                file: {
                  id: 'SIBLING-1',
                  name: 'Sibling.md',
                  mimeType: 'text/markdown',
                  modifiedTime: '2026-08-11T11:40:00.000Z',
                  parents: ['UNSELECTED-FOLDER'],
                },
              },
            ],
            newStartPageToken: 'drive-token-2',
          }),
        )
        .mockResolvedValueOnce(drivePermissionResponse());
      const result = await pullGoogleDriveDelta({
        connectionId,
        processEnv,
        vault,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        metadata: selectedDriveMetadata,
        cursor: {
          stream: 'google-drive:files',
          opaque: {
            startPageToken: 'drive-token-1',
            scopeKey:
              'google-drive:file:FILE-1:file:FILE-1:indexed|google-drive:folder:FOLDER-1:folder:FOLDER-1:reference',
            knownFiles: [
              {
                id: 'FILE-1',
                collectionId: 'google-drive:file:FILE-1',
                storageMode: 'indexed',
              },
              {
                id: 'CHILD-1',
                collectionId: 'google-drive:folder:FOLDER-1',
                storageMode: 'reference',
              },
            ],
            knownFolders: [
              {
                id: 'FOLDER-1',
                collectionId: 'google-drive:folder:FOLDER-1',
                storageMode: 'reference',
              },
            ],
          },
          schemaVersion: '2.0',
          updatedAt: '2026-08-11T10:00:00.000Z',
        },
      });
      expect(result.mode).toBe('vault');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.title).toMatch(/Spec update\.md/);
      expect(result.note).toMatch(/selected-scope/i);
      expect(result.nextCursor?.opaque.startPageToken).toBe('drive-token-2');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to a bounded selected-scope resync when the Drive change token expires', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-expired-'));
    try {
      const { processEnv, vault, vaultRef } = await createDriveVaultFixture(dir);
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response('page token expired', { status: 410 }))
        .mockResolvedValueOnce(Response.json({ startPageToken: 'drive-token-3' }))
        .mockResolvedValueOnce(
          Response.json({
            id: 'FILE-1',
            name: 'Roadmap.md',
            mimeType: 'text/markdown',
            modifiedTime: '2026-08-11T10:00:00.000Z',
            parents: ['ROOT'],
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            files: [],
          }),
        )
        .mockResolvedValueOnce(drivePermissionResponse());
      const syncRun = await runConnectorSync({
        connector: googleDriveConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            vaultRef,
            scopes: ['drive.file'],
            metadata: selectedDriveMetadata,
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildDefaultCursor(
            'google-drive:files',
            {
              startPageToken: 'expired-token',
              scopeKey:
                'google-drive:file:FILE-1:file:FILE-1:indexed|google-drive:folder:FOLDER-1:folder:FOLDER-1:reference',
              knownFiles: [
                {
                  id: 'REMOVED-1',
                  collectionId: 'google-drive:folder:FOLDER-1',
                  storageMode: 'reference',
                  title: 'Old child.md',
                },
              ],
              knownFolders: [
                {
                  id: 'FOLDER-1',
                  collectionId: 'google-drive:folder:FOLDER-1',
                  storageMode: 'reference',
                },
              ],
            },
            '2.0',
          ),
        },
      });
      expect(syncRun.page.mode).toBe('initial');
      expect(syncRun.records.some((record) => record.externalObject.deleted)).toBe(true);
      expect(
        syncRun.records.some(
          (record) =>
            record.envelope.event_type === 'google-drive.file.missing_from_scope_resync',
        ),
      ).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exports and parses indexed Google Docs, Sheets, and Slides from selected files and indexed folders', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-native-'));
    try {
      const { processEnv, vault, vaultRef } = await createDriveVaultFixture(dir);
      const metadata = {
        collections: {
          selection_mode: 'selected' as const,
          excluded_ids: [],
          items: [
            {
              id: 'google-drive:file:DOC-1',
              external_id: 'DOC-1',
              kind: 'file' as const,
              name: 'Roadmap',
              title: 'Roadmap',
              metadata: {
                storage_mode: 'indexed',
              },
            },
            {
              id: 'google-drive:folder:FOLDER-IDX',
              external_id: 'FOLDER-IDX',
              kind: 'folder' as const,
              name: 'Planning',
              title: 'Planning',
              metadata: {
                storage_mode: 'indexed',
              },
            },
            {
              id: 'google-drive:file:SLIDES-1',
              external_id: 'SLIDES-1',
              kind: 'file' as const,
              name: 'Deck',
              title: 'Deck',
              metadata: {
                storage_mode: 'indexed',
              },
            },
          ],
          project_bindings: {
            'google-drive:file:DOC-1': '44444444-4444-4444-8444-444444444431',
            'google-drive:folder:FOLDER-IDX': '44444444-4444-4444-8444-444444444432',
            'google-drive:file:SLIDES-1': '44444444-4444-4444-8444-444444444433',
          },
        },
      };
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ startPageToken: 'drive-token-native' }))
        .mockResolvedValueOnce(
          Response.json({
            id: 'DOC-1',
            name: 'Roadmap',
            mimeType: 'application/vnd.google-apps.document',
            modifiedTime: '2026-08-11T10:00:00.000Z',
            parents: ['ROOT'],
          }),
        )
        .mockResolvedValueOnce(drivePermissionResponse())
        .mockResolvedValueOnce(
          new Response('Quarterly roadmap body\nDecision: keep selected scope only.', {
            headers: { 'content-type': 'text/plain' },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            id: 'SLIDES-1',
            name: 'Deck',
            mimeType: 'application/vnd.google-apps.presentation',
            modifiedTime: '2026-08-11T08:00:00.000Z',
            parents: ['ROOT'],
          }),
        )
        .mockResolvedValueOnce(drivePermissionResponse())
        .mockResolvedValueOnce(
          new Response('Slide export body for search indexing.', {
            headers: { 'content-type': 'text/plain' },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            files: [
              {
                id: 'SHEET-1',
                name: 'Plan',
                mimeType: 'application/vnd.google-apps.spreadsheet',
                modifiedTime: '2026-08-11T09:00:00.000Z',
                parents: ['FOLDER-IDX'],
              },
            ],
          }),
        )
        .mockResolvedValueOnce(drivePermissionResponse())
        .mockResolvedValueOnce(
          new Response(
            createWorkbookBuffer({
              Plan: [
                ['Owner', 'Status'],
                ['Sasha', 'active'],
              ],
            }),
            {
              headers: {
                'content-type':
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              },
            },
          ),
        );

      const syncRun = await runConnectorSync({
        connector: googleDriveConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            vaultRef,
            scopes: ['drive.file'],
            metadata,
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      const byExternalId = new Map(
        syncRun.records.map((record) => [record.externalObject.externalId, record]),
      );
      expect(syncRun.records).toHaveLength(3);
      expect(byExternalId.get('file/DOC-1')?.capture.text).toContain('Quarterly roadmap body');
      expect(byExternalId.get('file/SLIDES-1')?.capture.text).toContain(
        'Slide export body for search indexing.',
      );
      expect(byExternalId.get('file/SHEET-1')?.capture.text).toContain('Sheet: Plan');
      expect(byExternalId.get('file/SHEET-1')?.capture.text).toContain('Owner\tStatus');
      expect(byExternalId.get('file/SHEET-1')?.capture.text).toContain('Sasha\tactive');
      expect(byExternalId.get('file/SHEET-1')?.envelope.scope.storage_mode).toBe('indexed');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tombstones an in-scope file when the permission snapshot shrinks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-perms-'));
    try {
      const { processEnv, vault, vaultRef } = await createDriveVaultFixture(dir);
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            changes: [
              {
                fileId: 'FILE-1',
                time: '2026-08-11T11:30:00.000Z',
                file: {
                  id: 'FILE-1',
                  name: 'Roadmap.md',
                  mimeType: 'text/markdown',
                  modifiedTime: '2026-08-11T11:30:00.000Z',
                  parents: ['ROOT'],
                },
              },
            ],
            newStartPageToken: 'drive-token-2',
          }),
        )
        .mockResolvedValueOnce(
          drivePermissionResponse({
            permissions: [
              {
                id: 'perm-owner',
                type: 'user',
                role: 'writer',
                emailAddress: 'owner@example.com',
              },
            ],
          }),
        );

      const syncRun = await runConnectorSync({
        connector: googleDriveConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            vaultRef,
            scopes: ['drive.file'],
            metadata: {
              collections: {
                selection_mode: 'selected',
                excluded_ids: [],
                items: [
                  {
                    id: 'google-drive:file:FILE-1',
                    external_id: 'FILE-1',
                    kind: 'file',
                    name: 'Roadmap.md',
                    title: 'Roadmap.md',
                    metadata: {
                      storage_mode: 'reference',
                    },
                  },
                ],
                project_bindings: {
                  'google-drive:file:FILE-1': '44444444-4444-4444-8444-444444444421',
                },
              },
            },
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildDefaultCursor(
            'google-drive:files',
            {
              startPageToken: 'drive-token-1',
              scopeKey: 'google-drive:file:FILE-1:file:FILE-1:reference',
              knownFiles: [
                {
                  id: 'FILE-1',
                  collectionId: 'google-drive:file:FILE-1',
                  storageMode: 'reference',
                  title: 'Roadmap.md',
                  permissionGrants: [
                    { principalKey: 'permission:perm-owner', role: 'writer' },
                    { principalKey: 'type:anyone', role: 'reader' },
                  ],
                  permissionFingerprint:
                    'permission:perm-owner:writer|type:anyone:reader',
                },
              ],
              knownFolders: [],
            },
            '2.0',
          ),
        },
      });

      expect(syncRun.records).toHaveLength(1);
      expect(syncRun.records[0]?.externalObject.deleted).toBe(true);
      expect(syncRun.records[0]?.envelope.event_type).toBe('google-drive.file.permission_lost');
      expect(syncRun.records[0]?.externalObject.permissionsSnapshot.reason).toBe(
        'permissions_snapshot_shrank',
      );
      expect(syncRun.nextCursor?.opaque.knownFiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('googleDriveConnector certification', () => {
  it('passes SDK certification smoke with selected Drive scope + change tokens', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-drive-cert-'));
    try {
      const { processEnv, vault, vaultRef } = await createDriveVaultFixture(dir);
      const fetchImpl = vi.fn();
      appendDriveInitialSyncResponses(fetchImpl);
      fetchImpl.mockResolvedValueOnce(
        Response.json({
          changes: [],
          newStartPageToken: 'drive-token-2',
        }),
      );
      appendDriveInitialSyncResponses(fetchImpl);
      appendDriveInitialSyncResponses(fetchImpl);
      fetchImpl.mockResolvedValueOnce(new Response('page token expired', { status: 410 }));
      appendDriveInitialSyncResponses(fetchImpl);
      fetchImpl.mockResolvedValueOnce(Response.json({ startPageToken: 'drive-health-token' }));

      const result = await runConnectorCertificationSmoke({
        connector: googleDriveConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'google-drive',
            displayName: 'Drive pilot',
            vaultRef,
            scopes: ['drive.file'],
            metadata: selectedDriveMetadata,
          },
          workspaceId: '11111111-1111-4111-8111-111111111111',
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(result.records).toHaveLength(2);
      expect(result.nextCursor?.opaque.startPageToken).toBe('drive-token-1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

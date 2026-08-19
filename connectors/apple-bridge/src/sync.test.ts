import { describe, expect, it } from 'vitest';
import {
  runConnectorCertification,
  runConnectorSync,
  type ConnectorSyncContext,
  type VaultStore,
} from '@memory-os/connector-sdk';
import {
  appleBridgeConnector,
  buildAppleFilesSelectionDelta,
  buildApplePhotoLibrarySelectionDelta,
  filterAppleBridgeRawObjectsForCurrentSelection,
  normalizeAppleBridgeRawObject,
  type AppleBridgeRawObject,
} from './sync.js';

function buildPhotoAsset(input: {
  itemId: string;
  title: string;
  observedAt: string;
  localIdentifier?: string;
  cloudIdentifier?: string;
  providerItemIdentifier?: string;
}): AppleBridgeRawObject {
  return {
    workspace_id: '11111111-1111-4111-8111-111111111111',
    project_id: '44444444-4444-4444-8444-444444444401',
    actor_subject_id: '33333333-3333-4333-8333-333333333301',
    device_id: 'fixture-iphone',
    connection_id: '88888888-8888-4888-8888-888888888899',
    item_id: input.itemId,
    kind: 'photo',
    title: input.title,
    filename: `${input.itemId}.HEIC`,
    mime_type: 'image/heic',
    observed_at: input.observedAt,
    external_version: input.observedAt,
    storage_mode: 'reference',
    sensitivity: 'internal',
    idempotency_key: `apple-share/${input.itemId}`,
    delete_local_after_ack: false,
    process_now: false,
    source: 'photo_library',
    identifiers: {
      local_identifier: input.localIdentifier,
      cloud_identifier: input.cloudIdentifier,
      provider_item_identifier: input.providerItemIdentifier,
    },
    metadata: {
      album: 'Limited imports',
    },
    permissions: {
      photo_library: 'limited',
    },
  };
}

function buildFileAsset(input: {
  itemId: string;
  title: string;
  observedAt: string;
  providerItemIdentifier: string;
  filename?: string;
}): AppleBridgeRawObject {
  return {
    workspace_id: '11111111-1111-4111-8111-111111111111',
    project_id: '44444444-4444-4444-8444-444444444401',
    actor_subject_id: '33333333-3333-4333-8333-333333333301',
    device_id: 'fixture-mac',
    connection_id: '88888888-8888-4888-8888-888888888899',
    item_id: input.itemId,
    kind: 'file',
    title: input.title,
    filename: input.filename ?? `${input.itemId}.md`,
    mime_type: 'text/markdown',
    observed_at: input.observedAt,
    external_version: input.observedAt,
    storage_mode: 'reference',
    sensitivity: 'internal',
    idempotency_key: `apple-document/${input.itemId}`,
    delete_local_after_ack: false,
    process_now: false,
    source: 'document_picker',
    identifiers: {
      provider_item_identifier: input.providerItemIdentifier,
    },
    metadata: {
      provider: 'icloud-drive',
    },
    permissions: {
      files: 'limited',
    },
  };
}

function buildConnectorContext(): ConnectorSyncContext {
  return {
    account: {
      connectionId: '88888888-8888-4888-8888-888888888899',
      connectorId: 'apple',
      displayName: 'Apple companion fixture',
      metadata: {},
    },
    workspaceId: '11111111-1111-4111-8111-111111111111',
  };
}

describe('appleBridgeConnector limited-library contract', () => {
  it('ingests only the explicitly selected limited-library assets', async () => {
    const checkpoint = {
      permission_state: 'limited' as const,
      selected_assets: [
        { local_identifier: 'PHOTO-LOCAL-1' },
        { cloud_identifier: 'PHOTO-CLOUD-2' },
      ],
      change_token: 'photokit-change-selected',
    };
    const rawObjects = [
      {
        ...buildPhotoAsset({
          itemId: 'photo-1',
          title: 'Selected local asset',
          observedAt: '2026-08-19T22:00:00.000Z',
          localIdentifier: 'PHOTO-LOCAL-1',
        }),
        photo_library_checkpoint: checkpoint,
      },
      {
        ...buildPhotoAsset({
          itemId: 'photo-2',
          title: 'Selected cloud asset',
          observedAt: '2026-08-19T22:01:00.000Z',
          cloudIdentifier: 'PHOTO-CLOUD-2',
        }),
        photo_library_checkpoint: checkpoint,
      },
      {
        ...buildPhotoAsset({
          itemId: 'photo-3',
          title: 'Unselected asset',
          observedAt: '2026-08-19T22:02:00.000Z',
          localIdentifier: 'PHOTO-LOCAL-3',
          cloudIdentifier: 'PHOTO-CLOUD-3',
        }),
        photo_library_checkpoint: checkpoint,
      },
    ];

    const filtered = filterAppleBridgeRawObjectsForCurrentSelection(rawObjects);
    const normalized = await Promise.all(
      filtered.map((rawObject) =>
        normalizeAppleBridgeRawObject({
          ...buildConnectorContext(),
          rawObject,
        }),
      ),
    );

    expect(filtered.map((rawObject) => rawObject.item_id)).toEqual(['photo-1', 'photo-2']);
    expect(normalized.map((record) => record.externalObject.externalId)).toEqual([
      'PHOTO-LOCAL-1',
      'PHOTO-CLOUD-2',
    ]);
  });

  it('tombstones assets that leave the limited selection without reinstalling', async () => {
    const selectedOne = buildPhotoAsset({
      itemId: 'photo-1',
      title: 'Selected local asset',
      observedAt: '2026-08-19T22:00:00.000Z',
      localIdentifier: 'PHOTO-LOCAL-1',
    });
    const selectedTwo = buildPhotoAsset({
      itemId: 'photo-2',
      title: 'Selected cloud asset',
      observedAt: '2026-08-19T22:01:00.000Z',
      cloudIdentifier: 'PHOTO-CLOUD-2',
    });

    const delta = buildApplePhotoLibrarySelectionDelta({
      previousCheckpoint: {
        permission_state: 'limited',
        selected_assets: [
          { local_identifier: 'PHOTO-LOCAL-1' },
          { cloud_identifier: 'PHOTO-CLOUD-2' },
        ],
        change_token: 'photokit-change-1',
      },
      nextCheckpoint: {
        permission_state: 'limited',
        selected_assets: [{ cloud_identifier: 'PHOTO-CLOUD-2' }],
        change_token: 'photokit-change-2',
      },
      knownAssets: [selectedOne, selectedTwo],
      currentAssets: [selectedTwo],
    });

    expect(delta).toHaveLength(1);
    expect(delta[0]?.deleted).toBe(true);
    expect(delta[0]?.identifiers.local_identifier).toBe('PHOTO-LOCAL-1');
    expect(delta[0]?.permissions?.photo_library).toBe('limited');
    expect(delta[0]?.metadata.photoLibraryDeltaReason).toBe('selection_removed');
  });

  it('emits revoke tombstones once and then stops photo-library ingest', () => {
    const selectedOne = buildPhotoAsset({
      itemId: 'photo-1',
      title: 'Selected local asset',
      observedAt: '2026-08-19T22:00:00.000Z',
      localIdentifier: 'PHOTO-LOCAL-1',
    });
    const selectedTwo = buildPhotoAsset({
      itemId: 'photo-2',
      title: 'Selected cloud asset',
      observedAt: '2026-08-19T22:01:00.000Z',
      cloudIdentifier: 'PHOTO-CLOUD-2',
    });
    const revokedCheckpoint = {
      permission_state: 'denied' as const,
      selected_assets: [],
      change_token: 'photokit-change-revoked',
    };

    const revokeDelta = buildApplePhotoLibrarySelectionDelta({
      previousCheckpoint: {
        permission_state: 'limited',
        selected_assets: [
          { local_identifier: 'PHOTO-LOCAL-1' },
          { cloud_identifier: 'PHOTO-CLOUD-2' },
        ],
        change_token: 'photokit-change-2',
      },
      nextCheckpoint: revokedCheckpoint,
      knownAssets: [selectedOne, selectedTwo],
      currentAssets: [],
    });
    const steadyStateDelta = buildApplePhotoLibrarySelectionDelta({
      previousCheckpoint: revokedCheckpoint,
      nextCheckpoint: revokedCheckpoint,
      knownAssets: [selectedOne, selectedTwo],
      currentAssets: [],
    });

    expect(revokeDelta).toHaveLength(2);
    expect(revokeDelta.every((rawObject) => rawObject.deleted)).toBe(true);
    expect(revokeDelta.every((rawObject) => rawObject.permissions?.photo_library === 'denied')).toBe(
      true,
    );
    expect(steadyStateDelta).toEqual([]);
  });

  it('represents full-library permission without implicitly expanding ingest scope', () => {
    const fullCheckpoint = {
      permission_state: 'full' as const,
      selected_assets: [],
      change_token: 'photokit-change-full',
    };
    const fullAsset = {
      ...buildPhotoAsset({
        itemId: 'photo-4',
        title: 'Full library asset',
        observedAt: '2026-08-19T22:03:00.000Z',
        localIdentifier: 'PHOTO-LOCAL-4',
      }),
      photo_library_checkpoint: fullCheckpoint,
      permissions: {
        photo_library: 'full',
      },
    };

    expect(filterAppleBridgeRawObjectsForCurrentSelection([fullAsset])).toEqual([]);
    expect(
      buildApplePhotoLibrarySelectionDelta({
        previousCheckpoint: null,
        nextCheckpoint: fullCheckpoint,
        knownAssets: [],
        currentAssets: [fullAsset],
      }),
    ).toEqual([]);
  });

  it('exhausts the incremental fixture cursor after the URL-4 delta', async () => {
    const initialRun = await runConnectorSync({
      connector: appleBridgeConnector,
      context: buildConnectorContext(),
    });
    const firstIncrementalRun = await runConnectorSync({
      connector: appleBridgeConnector,
      context: {
        ...buildConnectorContext(),
        cursor: initialRun.nextCursor,
      },
    });
    const secondIncrementalRun = await runConnectorSync({
      connector: appleBridgeConnector,
      context: {
        ...buildConnectorContext(),
        cursor: firstIncrementalRun.nextCursor,
      },
    });

    expect(firstIncrementalRun.page.rawObjects).toHaveLength(1);
    expect(firstIncrementalRun.nextCursor?.opaque.lastSeenExternalId).toBe('URL-4');
    expect(firstIncrementalRun.nextCursor?.opaque.photoLibraryChangeToken).toBe(
      'photokit-change-2',
    );
    expect(secondIncrementalRun.page.rawObjects).toEqual([]);
    expect(secondIncrementalRun.records).toEqual([]);
  });
});

describe('appleBridgeConnector files bookmark contract', () => {
  it('ingests only children under the selected folder and rejects sibling folders', async () => {
    const checkpoint = {
      permission_state: 'limited' as const,
      selected_bookmarks: [
        {
          bookmark_id: 'bookmark-projects-a',
          display_name: 'Projects/A',
          is_directory: true,
          provider_item_identifier: '/Projects/A',
          security_scoped_bookmark: 'opaque-bookmark-projects-a',
          last_accessed_at: '2026-08-19T22:00:00.000Z',
          stale: false,
        },
      ],
      folder_checkpoints: [
        {
          bookmark_id: 'bookmark-projects-a',
          provider_item_identifier: '/Projects/A',
          change_token: 'nsfileprovider-page-1',
        },
      ],
    };
    const rawObjects = [
      {
        ...buildFileAsset({
          itemId: 'file-1',
          title: 'Allowed child',
          observedAt: '2026-08-19T22:10:00.000Z',
          providerItemIdentifier: '/Projects/A/specs/roadmap.md',
        }),
        files_checkpoint: checkpoint,
      },
      {
        ...buildFileAsset({
          itemId: 'file-2',
          title: 'Rejected sibling',
          observedAt: '2026-08-19T22:11:00.000Z',
          providerItemIdentifier: '/Projects/B/specs/roadmap.md',
        }),
        files_checkpoint: checkpoint,
      },
    ];

    const filtered = filterAppleBridgeRawObjectsForCurrentSelection(rawObjects);
    const normalized = await Promise.all(
      filtered.map((rawObject) =>
        normalizeAppleBridgeRawObject({
          ...buildConnectorContext(),
          rawObject,
        }),
      ),
    );

    expect(filtered.map((rawObject) => rawObject.item_id)).toEqual(['file-1']);
    expect(normalized[0]?.externalObject.externalId).toBe('/Projects/A/specs/roadmap.md');
  });

  it('allows only the exact selected file for single-file bookmarks', () => {
    const delta = buildAppleFilesSelectionDelta({
      previousCheckpoint: null,
      nextCheckpoint: {
        permission_state: 'limited',
        selected_bookmarks: [
          {
            bookmark_id: 'bookmark-todo',
            display_name: 'todo.md',
            is_directory: false,
            provider_item_identifier: '/Inbox/todo.md',
            security_scoped_bookmark: 'opaque-bookmark-todo',
            last_accessed_at: '2026-08-19T22:12:00.000Z',
            stale: false,
          },
        ],
        folder_checkpoints: [],
      },
      knownFiles: [],
      currentFiles: [
        buildFileAsset({
          itemId: 'file-3',
          title: 'Selected todo',
          observedAt: '2026-08-19T22:12:00.000Z',
          providerItemIdentifier: '/Inbox/todo.md',
        }),
        buildFileAsset({
          itemId: 'file-4',
          title: 'Neighbor todo',
          observedAt: '2026-08-19T22:13:00.000Z',
          providerItemIdentifier: '/Inbox/todo-2.md',
        }),
      ],
    });

    expect(delta.status).toBe('ready');
    expect(delta.rawObjects.map((rawObject) => rawObject.item_id)).toEqual(['file-3']);
  });

  it('returns reselect_required for stale bookmarks without emitting ingest records', () => {
    const delta = buildAppleFilesSelectionDelta({
      previousCheckpoint: null,
      nextCheckpoint: {
        permission_state: 'limited',
        selected_bookmarks: [
          {
            bookmark_id: 'bookmark-projects-a',
            display_name: 'Projects/A',
            is_directory: true,
            provider_item_identifier: '/Projects/A',
            security_scoped_bookmark: 'opaque-bookmark-projects-a',
            last_accessed_at: '2026-08-19T22:14:00.000Z',
            stale: true,
          },
        ],
        folder_checkpoints: [
          {
            bookmark_id: 'bookmark-projects-a',
            provider_item_identifier: '/Projects/A',
            change_token: 'nsfileprovider-page-2',
          },
        ],
      },
      knownFiles: [],
      currentFiles: [
        buildFileAsset({
          itemId: 'file-5',
          title: 'Stale bookmark child',
          observedAt: '2026-08-19T22:14:30.000Z',
          providerItemIdentifier: '/Projects/A/specs/roadmap.md',
        }),
      ],
    });

    expect(delta).toEqual({
      status: 'reselect_required',
      error_code: 'reselect_required',
      stale_bookmark_ids: ['bookmark-projects-a'],
      rawObjects: [],
    });
  });

  it('tombstones prior files when a bookmark is removed', () => {
    const priorFile = buildFileAsset({
      itemId: 'file-6',
      title: 'Old selected child',
      observedAt: '2026-08-19T22:15:00.000Z',
      providerItemIdentifier: '/Projects/A/specs/roadmap.md',
    });

    const delta = buildAppleFilesSelectionDelta({
      previousCheckpoint: {
        permission_state: 'limited',
        selected_bookmarks: [
          {
            bookmark_id: 'bookmark-projects-a',
            display_name: 'Projects/A',
            is_directory: true,
            provider_item_identifier: '/Projects/A',
            security_scoped_bookmark: 'opaque-bookmark-projects-a',
            last_accessed_at: '2026-08-19T22:15:00.000Z',
            stale: false,
          },
        ],
        folder_checkpoints: [
          {
            bookmark_id: 'bookmark-projects-a',
            provider_item_identifier: '/Projects/A',
            change_token: 'nsfileprovider-page-2',
          },
        ],
      },
      nextCheckpoint: {
        permission_state: 'limited',
        selected_bookmarks: [],
        folder_checkpoints: [],
      },
      knownFiles: [priorFile],
      currentFiles: [],
    });

    expect(delta.status).toBe('ready');
    expect(delta.rawObjects).toHaveLength(1);
    expect(delta.rawObjects[0]?.deleted).toBe(true);
    expect(delta.rawObjects[0]?.metadata.filesSelectionDeltaReason).toBe('bookmark_removed');
  });
});

describe('appleBridgeConnector certification', () => {
  it('passes the full SDK certification kit without secrets or Apple hardware', async () => {
    const deletedVaultRefs: string[] = [];
    const vault: VaultStore = {
      async put() {
        return;
      },
      async get() {
        return null;
      },
      async delete(vaultRef) {
        deletedVaultRefs.push(vaultRef);
      },
    };

    const result = await runConnectorCertification({
      connector: appleBridgeConnector,
      context: {
        account: {
          connectionId: '88888888-8888-4888-8888-888888888899',
          connectorId: 'apple',
          displayName: 'Apple companion fixture',
          vaultRef: 'vault:test/apple',
          metadata: {},
        },
        workspaceId: '11111111-1111-4111-8111-111111111111',
        vault,
      },
    });

    expect(result.initialRun.records).toHaveLength(2);
    expect(result.initialRun.page.rawObjects).toHaveLength(3);
    expect(result.incrementalRun?.records).toHaveLength(1);
    expect(result.replayRun?.records.map((record) => record.capture.idempotencyKey)).toEqual(
      result.initialRun.records.map((record) => record.capture.idempotencyKey),
    );
    expect(result.resyncRun?.page.mode).toBe('initial');
    expect(result.cursorRecoveryRun?.page.mode).toBe('initial');
    expect(result.rateLimitError?.kind).toBe('rate_limit');
    expect(result.rateLimitError?.retryAfterMs).toBe(90_000);
    expect(result.healthcheck?.status).toBe('healthy');
    expect(result.revoked).toBe(true);
    expect(deletedVaultRefs).toContain('vault:test/apple');
  });
});

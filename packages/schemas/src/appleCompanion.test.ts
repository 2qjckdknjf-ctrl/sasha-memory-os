import { describe, expect, it } from 'vitest';
import {
  acknowledgeAppleCompanionQueueItem,
  appleCompanionFilesCheckpointSchema,
  appleCompanionIngestRequestSchema,
  appleCompanionPhotoLibraryCheckpointSchema,
  appleCompanionQueueSchema,
  canIngestAppleCompanionFile,
  canIngestApplePhotoLibraryAsset,
  createAppleCompanionQueueItem,
  markAppleCompanionQueueItemReselectRequired,
  matchesAppleCompanionSelectedAsset,
  markAppleCompanionQueueItemDone,
  markAppleCompanionQueueItemFailed,
  markAppleCompanionQueueItemUploading,
  resolveAppleCompanionFileBookmark,
  withAppleCompanionSecurityScopedLease,
} from './appleCompanion.js';

const basePayload = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  project_id: 'sasha-memory-os',
  actor_subject_id: '33333333-3333-4333-8333-333333333301',
  device_id: 'iphone-15-pro',
  connection_id: '88888888-8888-4888-8888-888888888810',
  item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'photo' as const,
  title: 'Whiteboard snapshot',
  filename: 'whiteboard.jpeg',
  mime_type: 'image/jpeg',
  observed_at: '2026-08-19T23:15:00.000Z',
  storage_mode: 'indexed' as const,
  sensitivity: 'internal' as const,
  idempotency_key: 'apple-share/iphone-15-pro/whiteboard-1',
  delete_local_after_ack: true,
  process_now: false,
  source: 'share_extension' as const,
  identifiers: {
    local_identifier: '8F9CF9E5-LOCAL',
    cloud_identifier: 'A1B2C3D4-CLOUD',
  },
  metadata: {
    album: 'Sprint Review',
  },
};

describe('appleCompanionIngestRequestSchema', () => {
  it('accepts a companion upload that targets a project slug', () => {
    const parsed = appleCompanionIngestRequestSchema.parse(basePayload);
    expect(parsed.project_id).toBe('sasha-memory-os');
    expect(parsed.identifiers.cloud_identifier).toBe('A1B2C3D4-CLOUD');
  });
});

describe('appleCompanionPhotoLibraryCheckpointSchema', () => {
  it('round-trips a limited-library checkpoint with durable selected asset identifiers', () => {
    const parsed = appleCompanionPhotoLibraryCheckpointSchema.parse({
      permission_state: 'limited',
      selected_assets: [
        { local_identifier: 'PHOTO-LOCAL-1' },
        { cloud_identifier: 'PHOTO-CLOUD-2' },
      ],
      change_token: 'photokit-change-2',
    });

    expect(parsed.permission_state).toBe('limited');
    expect(parsed.selected_assets).toHaveLength(2);
    expect(parsed.change_token).toBe('photokit-change-2');
  });

  it('requires at least one durable identifier for every selected asset', () => {
    expect(() =>
      appleCompanionPhotoLibraryCheckpointSchema.parse({
        permission_state: 'limited',
        selected_assets: [{}],
        change_token: 'photokit-change-3',
      }),
    ).toThrow(/selected assets require at least one durable identifier/i);
  });
});

describe('appleCompanionFilesCheckpointSchema', () => {
  it('round-trips selected files bookmarks and folder monitor checkpoints', () => {
    const parsed = appleCompanionFilesCheckpointSchema.parse({
      permission_state: 'limited',
      selected_bookmarks: [
        {
          bookmark_id: 'bookmark-projects-a',
          display_name: 'Projects/A',
          is_directory: true,
          provider_item_identifier: '/Projects/A',
          security_scoped_bookmark: 'opaque-bookmark-a',
          last_accessed_at: '2026-08-19T23:20:00.000Z',
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
    });

    expect(parsed.selected_bookmarks[0]?.display_name).toBe('Projects/A');
    expect(parsed.folder_checkpoints[0]?.change_token).toBe('nsfileprovider-page-2');
  });
});

describe('limited-library helpers', () => {
  const selectedAssets = [{ local_identifier: 'PHOTO-LOCAL-1' }, { cloud_identifier: 'PHOTO-CLOUD-2' }];

  it('matches selected assets through either local or cloud identifiers', () => {
    expect(
      matchesAppleCompanionSelectedAsset({
        identifiers: { local_identifier: 'PHOTO-LOCAL-1' },
        selectedAssets,
      }),
    ).toBe(true);
    expect(
      matchesAppleCompanionSelectedAsset({
        identifiers: { cloud_identifier: 'PHOTO-CLOUD-2' },
        selectedAssets,
      }),
    ).toBe(true);
    expect(
      matchesAppleCompanionSelectedAsset({
        identifiers: { local_identifier: 'PHOTO-LOCAL-3', cloud_identifier: 'PHOTO-CLOUD-3' },
        selectedAssets,
      }),
    ).toBe(false);
  });

  it('allows only explicitly selected assets when permission is limited', () => {
    expect(
      canIngestApplePhotoLibraryAsset({
        permissionState: 'limited',
        identifiers: { local_identifier: 'PHOTO-LOCAL-1' },
        selectedAssets,
      }),
    ).toBe(true);
    expect(
      canIngestApplePhotoLibraryAsset({
        permissionState: 'limited',
        identifiers: { cloud_identifier: 'PHOTO-CLOUD-3' },
        selectedAssets,
      }),
    ).toBe(false);
  });

  it('represents full-library permission without implicitly expanding ingest scope', () => {
    expect(
      canIngestApplePhotoLibraryAsset({
        permissionState: 'full',
        identifiers: { local_identifier: 'PHOTO-LOCAL-1' },
        selectedAssets,
      }),
    ).toBe(false);
  });
});

describe('selected-files bookmark helpers', () => {
  const selectedBookmarks = [
    {
      bookmark_id: 'bookmark-projects-a',
      display_name: 'Projects/A',
      is_directory: true as const,
      provider_item_identifier: '/Projects/A',
      security_scoped_bookmark: 'opaque-bookmark-projects-a',
      last_accessed_at: '2026-08-19T23:20:00.000Z',
      stale: false,
    },
    {
      bookmark_id: 'bookmark-exact-file',
      display_name: 'todo.md',
      is_directory: false as const,
      provider_item_identifier: '/Inbox/todo.md',
      security_scoped_bookmark: 'opaque-bookmark-todo',
      last_accessed_at: '2026-08-19T23:21:00.000Z',
      stale: false,
    },
  ];

  it('allows a child of a selected folder and rejects a sibling folder', () => {
    expect(
      canIngestAppleCompanionFile({
        identifiers: { provider_item_identifier: '/Projects/A/specs/roadmap.md' },
        selectedBookmarks,
      }),
    ).toBe(true);
    expect(
      canIngestAppleCompanionFile({
        identifiers: { provider_item_identifier: '/Projects/B/specs/roadmap.md' },
        selectedBookmarks,
      }),
    ).toBe(false);
  });

  it('allows only the exact selected file when the bookmark is a file', () => {
    expect(
      canIngestAppleCompanionFile({
        identifiers: { provider_item_identifier: '/Inbox/todo.md' },
        selectedBookmarks,
      }),
    ).toBe(true);
    expect(
      canIngestAppleCompanionFile({
        identifiers: { provider_item_identifier: '/Inbox/todo-2.md' },
        selectedBookmarks,
      }),
    ).toBe(false);
  });

  it('requires a visible reselect when a matching bookmark is stale', () => {
    const resolution = resolveAppleCompanionFileBookmark({
      identifiers: { provider_item_identifier: '/Projects/A/specs/roadmap.md' },
      selectedBookmarks: [
        {
          ...selectedBookmarks[0],
          stale: true,
        },
      ],
    });

    expect(resolution).toEqual({
      status: 'reselect_required',
      error_code: 'reselect_required',
      stale_bookmark_ids: ['bookmark-projects-a'],
    });
  });
});

describe('appleCompanionQueueSchema', () => {
  it('round-trips an offline queued item without losing state', () => {
    const queue = [
      createAppleCompanionQueueItem({
        payload: basePayload,
        queuedAt: '2026-08-19T23:16:00.000Z',
      }),
    ];

    const serialized = JSON.stringify(queue);
    const parsed = appleCompanionQueueSchema.parse(JSON.parse(serialized));

    expect(parsed[0]?.state).toBe('pending');
    expect(parsed[0]?.delete_local_after_ack).toBe(true);
    expect(parsed[0]?.payload.source).toBe('share_extension');
  });

  it('removes an acknowledged item from the durable queue', () => {
    const queue = [
      createAppleCompanionQueueItem({
        payload: basePayload,
        queuedAt: '2026-08-19T23:16:00.000Z',
      }),
    ];

    const done = markAppleCompanionQueueItemDone(
      markAppleCompanionQueueItemUploading(queue, basePayload.item_id, '2026-08-19T23:17:00.000Z'),
      basePayload.item_id,
      '2026-08-19T23:18:00.000Z',
    );
    const acked = acknowledgeAppleCompanionQueueItem(done, basePayload.item_id);

    expect(done[0]?.state).toBe('done');
    expect(acked).toEqual([]);
  });

  it('increments retry state after a failed upload attempt', () => {
    const queue = [
      createAppleCompanionQueueItem({
        payload: {
          ...basePayload,
          item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          kind: 'text' as const,
          text: 'Meeting notes',
          filename: undefined,
          mime_type: 'text/plain',
        },
        queuedAt: '2026-08-19T23:16:00.000Z',
      }),
    ];

    const uploading = markAppleCompanionQueueItemUploading(
      queue,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '2026-08-19T23:17:00.000Z',
    );
    const failed = markAppleCompanionQueueItemFailed(
      uploading,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'network timeout',
      '2026-08-19T23:18:00.000Z',
      90_000,
    );

    expect(failed[0]?.state).toBe('failed');
    expect(failed[0]?.attempt_count).toBe(1);
    expect(failed[0]?.last_error).toBe('network timeout');
    expect(failed[0]?.next_retry_at).toBe('2026-08-19T23:19:30.000Z');
  });

  it('surfaces stale bookmark failures as reselect_required without a retry timer', () => {
    const queue = [
      createAppleCompanionQueueItem({
        payload: {
          ...basePayload,
          item_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          kind: 'file' as const,
          title: 'Projects roadmap',
          filename: 'roadmap.md',
          mime_type: 'text/markdown',
          source: 'document_picker' as const,
          identifiers: {
            provider_item_identifier: '/Projects/A/specs/roadmap.md',
          },
        },
        queuedAt: '2026-08-19T23:16:00.000Z',
      }),
    ];

    const failed = markAppleCompanionQueueItemReselectRequired(
      queue,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      '2026-08-19T23:17:00.000Z',
    );

    expect(failed[0]?.state).toBe('failed');
    expect(failed[0]?.last_error).toBe('reselect_required');
    expect(failed[0]?.last_error_code).toBe('reselect_required');
    expect(failed[0]?.next_retry_at).toBeNull();
  });
});

describe('security-scoped lease helper', () => {
  it('always stops access after read failures', async () => {
    const events: string[] = [];
    await expect(
      withAppleCompanionSecurityScopedLease({
        bookmark: {
          bookmark_id: 'bookmark-projects-a',
          display_name: 'Projects/A',
          is_directory: true,
          provider_item_identifier: '/Projects/A',
          security_scoped_bookmark: 'opaque-bookmark-projects-a',
          last_accessed_at: '2026-08-19T23:20:00.000Z',
          stale: false,
        },
        startAccessing(bookmark) {
          events.push(`start:${bookmark.bookmark_id}`);
          return {
            bookmark_id: bookmark.bookmark_id,
            stopAccessing() {
              events.push(`stop:${bookmark.bookmark_id}`);
            },
          };
        },
        async read() {
          events.push('read');
          throw new Error('poison');
        },
      }),
    ).rejects.toThrow(/poison/i);

    expect(events).toEqual([
      'start:bookmark-projects-a',
      'read',
      'stop:bookmark-projects-a',
    ]);
  });
});

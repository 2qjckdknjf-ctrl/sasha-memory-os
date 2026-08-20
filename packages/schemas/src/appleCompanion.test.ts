import { describe, expect, it } from 'vitest';
import {
  acknowledgeAppleCompanionQueueItem,
  appleCompanionFilesCheckpointSchema,
  appleCompanionIngestRequestSchema,
  appleCompanionPhotoLibraryCheckpointSchema,
  appleCompanionQueueSchema,
  appleCompanionQueueSnapshotSchema,
  appleCompanionTransferredObjectDeleteRequestSchema,
  appleCompanionTransferredObjectSchema,
  appleCompanionTransferredObjectsListQuerySchema,
  canIngestAppleCompanionFile,
  canIngestApplePhotoLibraryAsset,
  createAppleCompanionQueueItem,
  drainAppleCompanionQueue,
  mapAppleCompanionSharePayload,
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

const baseSharePayload = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  project_id: 'sasha-memory-os',
  actor_subject_id: '33333333-3333-4333-8333-333333333301',
  device_id: 'iphone-15-pro',
  connection_id: '88888888-8888-4888-8888-888888888810',
  item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sensitivity: 'internal' as const,
  storage_mode: 'indexed' as const,
  memory_type: 'idea' as const,
  idempotency_key: 'apple-share/iphone-15-pro/share-1',
  delete_local_after_ack: true,
  identifiers: {
    local_identifier: '8F9CF9E5-LOCAL',
  },
  metadata: {
    shared_from: 'Notes',
  },
};

describe('appleCompanionIngestRequestSchema', () => {
  it('accepts a companion upload that targets a project slug', () => {
    const parsed = appleCompanionIngestRequestSchema.parse(basePayload);
    expect(parsed.project_id).toBe('sasha-memory-os');
    expect(parsed.identifiers.cloud_identifier).toBe('A1B2C3D4-CLOUD');
  });
});

describe('apple transferred objects contracts', () => {
  it('requires project_id for project-scoped transferred-object reads', () => {
    expect(() =>
      appleCompanionTransferredObjectsListQuerySchema.parse({
        workspace_id: '11111111-1111-4111-8111-111111111111',
        project_id: '',
      }),
    ).toThrow(/project_id is required for this read/i);
  });

  it('round-trips a transferred Apple object summary', () => {
    const parsed = appleCompanionTransferredObjectSchema.parse({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspace_id: '11111111-1111-4111-8111-111111111111',
      project_id: '44444444-4444-4444-8444-444444444401',
      title: 'Shared whiteboard',
      status: 'candidate',
      kind: 'photo',
      source: 'share_extension',
      sensitivity: 'internal',
      memory_type: 'idea',
      source_event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      device_id: 'iphone-15-pro',
      connection_id: '88888888-8888-4888-8888-888888888810',
      item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      filename: 'whiteboard.jpeg',
      canonical_reference: 'apple://photo/APPLE-LOCAL-1',
      observed_at: '2026-08-19T23:15:00.000Z',
      recorded_at: '2026-08-19T23:16:00.000Z',
      delete_local_after_ack: true,
      identifiers: {
        local_identifier: 'APPLE-LOCAL-1',
        cloud_identifier: 'APPLE-CLOUD-1',
      },
    });

    expect(parsed.source).toBe('share_extension');
    expect(parsed.kind).toBe('photo');
    expect(parsed.delete_local_after_ack).toBe(true);
  });

  it('requires project_id for transferred-object tombstones', () => {
    expect(() =>
      appleCompanionTransferredObjectDeleteRequestSchema.parse({
        project_id: '',
        actor_subject_id: '33333333-3333-4333-8333-333333333301',
        reason: 'User requested deletion from Memory OS.',
      }),
    ).toThrow(/project_id is required for this write/i);
  });
});

describe('mapAppleCompanionSharePayload', () => {
  it.each([
    [
      'text',
      {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        idempotency_key: 'apple-share/iphone-15-pro/text-1',
        kind: 'text' as const,
        text: 'Shared notes from a meeting.',
      },
    ],
    [
      'url',
      {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        idempotency_key: 'apple-share/iphone-15-pro/url-1',
        kind: 'url' as const,
        url: 'https://example.com/share',
      },
    ],
    [
      'photo',
      {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        idempotency_key: 'apple-share/iphone-15-pro/photo-1',
        kind: 'photo' as const,
        filename: 'whiteboard.jpeg',
        mime_type: 'image/jpeg',
      },
    ],
    [
      'video',
      {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        idempotency_key: 'apple-share/iphone-15-pro/video-1',
        kind: 'video' as const,
        filename: 'demo.mov',
        mime_type: 'video/quicktime',
      },
    ],
    [
      'file',
      {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
        idempotency_key: 'apple-share/iphone-15-pro/file-1',
        kind: 'file' as const,
        filename: 'roadmap.md',
        mime_type: 'text/markdown',
      },
    ],
  ])('maps %s shares into a durable ingest request and queue item', (_kind, share) => {
    const mapped = mapAppleCompanionSharePayload({
      share,
      queuedAt: '2026-08-19T23:16:00.000Z',
    });

    expect(mapped.request.kind).toBe(share.kind);
    expect(mapped.request.project_id).toBe('sasha-memory-os');
    expect(mapped.request.storage_mode).toBe('indexed');
    expect(mapped.request.sensitivity).toBe('internal');
    expect(mapped.request.memory_type).toBe('idea');
    expect(mapped.request.source).toBe('share_extension');
    expect(mapped.request.process_now).toBe(false);
    expect(mapped.request.needs_companion_processing).toBe(true);
    expect(mapped.queueItem.id).toBe(share.item_id);
    expect(mapped.queueItem.state).toBe('pending');
    expect(mapped.queueItem.status_label).toBe('pending');
    expect(mapped.queueItem.payload.idempotency_key).toBe(share.idempotency_key);
  });

  it('rejects shares without project_id before enqueue', () => {
    expect(() =>
      mapAppleCompanionSharePayload({
        share: {
          ...baseSharePayload,
          item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
          idempotency_key: 'apple-share/iphone-15-pro/no-project-1',
          kind: 'text',
          text: 'Projectless shares must fail.',
          project_id: '',
        },
      }),
    ).toThrow(/project_id/i);
  });

  it('keeps extension intake queue-only and defers heavy processing to the companion', () => {
    const mapped = mapAppleCompanionSharePayload({
      share: {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
        idempotency_key: 'apple-share/iphone-15-pro/text-queue-only',
        kind: 'text',
        text: 'Queue only share.',
      },
    });

    expect(mapped.request.process_now).toBe(false);
    expect(mapped.request.needs_companion_processing).toBe(true);
    expect(mapped.request.metadata).toEqual({
      shared_from: 'Notes',
    });
    expect(mapped.request).not.toHaveProperty('normalized');
    expect(mapped.request).not.toHaveProperty('ocr_text');
    expect(mapped.request).not.toHaveProperty('llm_summary');
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

describe('drainAppleCompanionQueue', () => {
  it('persists an offline share across a process restart and marks it done after network recovery', async () => {
    const mapped = mapAppleCompanionSharePayload({
      share: {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
        idempotency_key: 'apple-share/iphone-15-pro/offline-1',
        kind: 'url',
        url: 'https://example.com/offline-share',
      },
      queuedAt: '2026-08-19T23:16:00.000Z',
    });
    const snapshot = appleCompanionQueueSnapshotSchema.parse({
      items: [mapped.queueItem],
      cursor: {},
    });
    const restarted = appleCompanionQueueSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));

    expect(restarted.items).toHaveLength(1);
    expect(restarted.items[0]?.state).toBe('pending');
    expect(restarted.items[0]?.status_label).toBe('pending');

    const drained = await drainAppleCompanionQueue({
      queue: restarted.items,
      now: '2026-08-19T23:20:00.000Z',
      transport: () => ({
        status: 'acknowledged',
        delete_local_after_ack: true,
      }),
    });

    expect(drained[0]?.state).toBe('done');
    expect(drained[0]?.status_label).toBe('done');
    expect(drained[0]?.delete_local_after_ack).toBe(true);
    expect(drained[0]?.completed_at).toBe('2026-08-19T23:20:00.000Z');
  });

  it('keeps a missing-project 400 as failed without a retry timer', async () => {
    const mapped = mapAppleCompanionSharePayload({
      share: {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
        idempotency_key: 'apple-share/iphone-15-pro/missing-project-400',
        kind: 'text',
        text: 'Bad share payload already reached drain.',
      },
    });

    const drained = await drainAppleCompanionQueue({
      queue: [mapped.queueItem],
      now: '2026-08-19T23:21:00.000Z',
      transport: () => ({
        status: 'validation_error',
        error: 'project_id is required for this write',
        http_status: 400,
      }),
    });

    expect(drained[0]?.state).toBe('failed');
    expect(drained[0]?.status_label).toBe('failed');
    expect(drained[0]?.last_error).toBe('project_id is required for this write');
    expect(drained[0]?.next_retry_at).toBeNull();
  });

  it('does not schedule a retry when the companion requires bookmark reselection', async () => {
    const mapped = mapAppleCompanionSharePayload({
      share: {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
        idempotency_key: 'apple-share/iphone-15-pro/reselect-1',
        kind: 'file',
        filename: 'roadmap.md',
        mime_type: 'text/markdown',
      },
    });

    const drained = await drainAppleCompanionQueue({
      queue: [mapped.queueItem],
      now: '2026-08-19T23:22:00.000Z',
      transport: () => ({
        status: 'reselect_required',
        error: 'stale bookmark',
      }),
    });

    expect(drained[0]?.state).toBe('failed');
    expect(drained[0]?.status_label).toBe('reselect_required');
    expect(drained[0]?.last_error_code).toBe('reselect_required');
    expect(drained[0]?.next_retry_at).toBeNull();
  });

  it('retries the same large-file queue row with the same idempotency key after a network failure', async () => {
    const mapped = mapAppleCompanionSharePayload({
      share: {
        ...baseSharePayload,
        item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
        idempotency_key: 'apple-share/iphone-15-pro/large-file-1',
        kind: 'video',
        filename: 'large-demo.mov',
        mime_type: 'video/quicktime',
      },
      queuedAt: '2026-08-19T23:16:00.000Z',
    });

    const firstAttempt = await drainAppleCompanionQueue({
      queue: [mapped.queueItem],
      now: '2026-08-19T23:23:00.000Z',
      transport: () => ({
        status: 'network_error',
        error: 'network timeout',
        retry_delay_ms: 120_000,
      }),
    });

    expect(firstAttempt).toHaveLength(1);
    expect(firstAttempt[0]?.state).toBe('failed');
    expect(firstAttempt[0]?.status_label).toBe('failed');
    expect(firstAttempt[0]?.attempt_count).toBe(1);
    expect(firstAttempt[0]?.payload.idempotency_key).toBe('apple-share/iphone-15-pro/large-file-1');
    expect(firstAttempt[0]?.next_retry_at).toBe('2026-08-19T23:25:00.000Z');

    const secondAttempt = await drainAppleCompanionQueue({
      queue: firstAttempt,
      now: '2026-08-19T23:25:30.000Z',
      transport: (item) => {
        expect(item.payload.idempotency_key).toBe('apple-share/iphone-15-pro/large-file-1');
        return {
          status: 'acknowledged',
        };
      },
    });

    expect(secondAttempt).toHaveLength(1);
    expect(secondAttempt[0]?.state).toBe('done');
    expect(secondAttempt[0]?.status_label).toBe('done');
    expect(secondAttempt[0]?.payload.idempotency_key).toBe('apple-share/iphone-15-pro/large-file-1');
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

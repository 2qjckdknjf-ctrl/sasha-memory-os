import { describe, expect, it } from 'vitest';
import {
  acknowledgeAppleCompanionQueueItem,
  appleCompanionIngestRequestSchema,
  appleCompanionQueueSchema,
  createAppleCompanionQueueItem,
  markAppleCompanionQueueItemDone,
  markAppleCompanionQueueItemFailed,
  markAppleCompanionQueueItemUploading,
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
});

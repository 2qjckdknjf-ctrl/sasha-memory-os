import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from './supabase.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const env = loadMemoryOsEnv();
const describeRemote = env ? describe : describe.skip;

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444401';
const owner = '33333333-3333-4333-8333-333333333301';

describeRemote('remote Supabase RPCs (vault / embed / consolidation)', () => {
  // Lazily construct — vitest still evaluates describe.skip bodies during collect.
  const gateway = () =>
    new SupabaseMemoryGateway(createMemoryOsClient(env!), env!.apiSecret);

  it(
    'round-trips shared vault ciphertext',
    async () => {
      const vaultRef = `vault:test/rpc-${randomUUID()}`;
      const ciphertext = Buffer.from(`cipher-${Date.now()}`, 'utf8').toString(
        'base64',
      );
      const put = await gateway().vaultPut({
        vaultRef,
        ciphertextBase64: ciphertext,
      });
      expect(put.ok).toBe(true);
      const got = await gateway().vaultGet(vaultRef);
      expect(got.found).toBe(true);
      expect(got.ciphertext).toBe(ciphertext);
      const del = await gateway().vaultDelete(vaultRef);
      expect(del.ok).toBe(true);
      const missing = await gateway().vaultGet(vaultRef);
      expect(missing.found).toBe(false);
    },
    20_000,
  );

  it(
    'round-trips supabase_vault KMS secret',
    async () => {
      const vaultRef = `vault:kms/test-${randomUUID()}`;
      const plaintext = Buffer.from(`kms-${Date.now()}`, 'utf8').toString(
        'base64',
      );
      const put = await gateway().vaultKmsPut({ vaultRef, plaintext });
      expect(put.ok).toBe(true);
      expect(put.backend).toBe('supabase_vault');
      const got = await gateway().vaultKmsGet(vaultRef);
      expect(got.found).toBe(true);
      expect(got.plaintext).toBe(plaintext);
      const del = await gateway().vaultKmsDelete(vaultRef);
      expect(del.deleted).toBe(true);
      const missing = await gateway().vaultKmsGet(vaultRef);
      expect(missing.found).toBe(false);
    },
    20_000,
  );

  it(
    'enqueues consolidation, lists pending outbox, then completes',
    async () => {
      const enq = await gateway().enqueueConsolidation({
        subjectId: owner,
        workspaceId,
      });
      expect(enq.jobId).toBeTruthy();
      expect(enq.idempotencyKey).toMatch(/^consolidate\//);

      const again = await gateway().enqueueConsolidation({
        subjectId: owner,
        workspaceId,
      });
      expect(again.jobId).toBe(enq.jobId);
      expect(again.idempotencyKey).toBe(enq.idempotencyKey);

      // Same-minute idempotency: list only has a pending row when this minute
      // still has an unpublished outbox (first insert, or prior run not completed).
      const pending = await gateway().listOutboxPending({
        subjectId: owner,
        workspaceId,
        eventType: 'memory.consolidation.requested',
        limit: 10,
      });
      expect(Array.isArray(pending.events)).toBe(true);
      if (enq.inserted || again.inserted) {
        expect(pending.count).toBeGreaterThanOrEqual(1);
        expect(
          pending.events.some((e) => e.payload?.jobId === enq.jobId),
        ).toBe(true);
      }

      const stale = await gateway().deadLetterStaleJobs({
        subjectId: owner,
        workspaceId,
        olderThanMinutes: 10_000,
      });
      expect(stale.deadLettered).toBe(0);

      const done = await gateway().completeConsolidation({
        subjectId: owner,
        jobId: enq.jobId,
        status: 'succeeded',
      });
      expect(done.status).toBe('succeeded');
      expect(done.jobType).toBe('consolidate');

      // complete() publishes the consolidation outbox row
      const after = await gateway().listOutboxPending({
        subjectId: owner,
        workspaceId,
        eventType: 'memory.consolidation.requested',
        limit: 50,
      });
      expect(
        after.events.every((e) => e.payload?.jobId !== enq.jobId),
      ).toBe(true);

      const eventId = pending.events.find((e) => e.payload?.jobId === enq.jobId)
        ?.id;
      if (eventId) {
        const published = await gateway().publishOutboxEvent({
          subjectId: owner,
          eventId,
          error: 'acked in rpc smoke',
        });
        expect(published.publishedAt).toBeTruthy();
      }
    },
    20_000,
  );

  it(
    'persists 32-dim embedding and hybrid-searches',
    async () => {
      const key = `remote-test/embed-${Date.now()}`;
      const fullText =
        'Hybrid vector smoke test for Memory OS embeddings. ' +
        'Pad '.repeat(80) +
        'TAIL_MARKER_XYZ';
      const capture = (await gateway().captureText({
        subjectId: owner,
        workspaceId,
        projectId,
        title: 'Remote embed smoke',
        text: fullText,
        idempotencyKey: key,
        processNow: true,
      })) as { process?: { memoryId?: string | null } };
      const memoryId = capture.process?.memoryId;
      expect(memoryId).toBeTruthy();
      const got = await gateway().getMemory({
        subjectId: owner,
        memoryId: memoryId!,
      });
      expect(got.content).toContain('TAIL_MARKER_XYZ');
      const listed = await gateway().listMemories({
        subjectId: owner,
        workspaceId,
        projectId,
        limit: 50,
      });
      const listedHit = listed.find((row) => row.id === memoryId);
      expect(listedHit).toBeTruthy();
      // list truncates to 500; get_memory returns the stored full body
      expect(got.content.length).toBeGreaterThanOrEqual(
        listedHit!.content.length,
      );
      if (got.content.length > 500) {
        expect(listedHit!.content.length).toBe(500);
        expect(listedHit!.content.includes('TAIL_MARKER_XYZ')).toBe(false);
      }
      const vector = Array.from({ length: 32 }, (_, i) => (i === 0 ? 1 : 0));
      const embedded = await gateway().setMemoryEmbedding({
        subjectId: owner,
        memoryId: memoryId!,
        embedding: vector,
        engine: 'stub-hash',
      });
      expect(embedded.dims).toBe(32);
      expect(embedded.hasVector).toBe(true);
      const hits = (await gateway().search({
        subjectId: owner,
        query: 'Hybrid vector smoke',
        projectId,
        queryEmbedding: vector,
      })) as unknown[];
      expect(Array.isArray(hits)).toBe(true);
    },
    20_000,
  );
});

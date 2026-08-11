import { config } from 'dotenv';
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

const projectId = '44444444-4444-4444-8444-444444444401';
const chatgpt = '33333333-3333-4333-8333-333333333302';
const cursor = '33333333-3333-4333-8333-333333333303';
const stranger = '99999999-9999-4999-8999-999999999999';

describeRemote('remote Supabase RLS via API RPCs', () => {
  // Lazily construct — vitest still evaluates describe.skip bodies during collect.
  const gateway = () =>
    new SupabaseMemoryGateway(createMemoryOsClient(env!), env!.apiSecret);

  it('lets cursor read project context', async () => {
    const ctx = (await gateway().projectContext(cursor, projectId)) as {
      decisions: unknown[];
    };
    expect(ctx.decisions.length).toBeGreaterThan(0);
  });

  it('lets chatgpt write decisions idempotently', async () => {
    const key = `remote-test/decision-${Date.now()}`;
    const a = await gateway().createDecision({
      subjectId: chatgpt,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId,
      title: 'Remote RLS write check',
      content: 'Created through api_create_decision RPC.',
      idempotencyKey: key,
    });
    const b = await gateway().createDecision({
      subjectId: chatgpt,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      projectId,
      title: 'Remote RLS write check',
      content: 'Created through api_create_decision RPC.',
      idempotencyKey: key,
    });
    expect((a as { id: string }).id).toBe((b as { id: string }).id);
  });

  it('denies cursor write to memory', async () => {
    const probe = (await gateway().rlsProbe({
      subjectId: cursor,
      projectId,
      sensitivity: 'internal',
    })) as { canWriteMemory: boolean; canReadMemory: boolean };
    expect(probe.canReadMemory).toBe(true);
    expect(probe.canWriteMemory).toBe(false);
  });

  it('denies cursor personal sensitivity', async () => {
    const probe = (await gateway().rlsProbe({
      subjectId: cursor,
      projectId,
      sensitivity: 'personal',
    })) as { canReadMemory: boolean };
    expect(probe.canReadMemory).toBe(false);
  });

  it('denies stranger subject', async () => {
    await expect(gateway().projectContext(stranger, projectId)).rejects.toThrow();
  });

  it('rejects wrong api secret', async () => {
    const bad = new SupabaseMemoryGateway(
      createMemoryOsClient(env!),
      'wrong-secret',
    );
    await expect(bad.projectContext(cursor, projectId)).rejects.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  normalizeAgentSourceEvent,
  normalizePollingSourceEvent,
  normalizeWebhookSourceEvent,
} from './sourceEventAdapters.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '44444444-4444-4444-8444-444444444401';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('M15.1 source-event adapters', () => {
  it('normalizes webhook deliveries with stable replay keys', () => {
    const first = normalizeWebhookSourceEvent({
      workspaceId,
      projectId,
      provider: 'github',
      accountId,
      deliveryId: 'deliv-1',
      eventType: 'github.push',
      observedAt: '2026-08-21T20:00:00.000Z',
      externalId: 'repo:1',
      payload: { ref: 'refs/heads/main' },
    });
    const replay = normalizeWebhookSourceEvent({
      workspaceId,
      projectId,
      provider: 'github',
      accountId,
      deliveryId: 'deliv-1',
      eventType: 'github.push',
      observedAt: '2026-08-21T20:00:01.000Z',
      externalId: 'repo:1',
      payload: { ref: 'refs/heads/main' },
    });
    expect(first.idempotency_key).toBe(replay.idempotency_key);
    expect(first.ingestion_adapter).toBe('webhook');
    expect(first.scope.project_id).toBe(projectId);
  });

  it('normalizes polling and agent envelopes without default-project fallback', () => {
    const polling = normalizePollingSourceEvent({
      workspaceId,
      projectId,
      provider: 'gmail',
      accountId,
      externalId: 'msg-1',
      externalVersion: 'history-9',
      eventType: 'gmail.message.upsert',
      observedAt: '2026-08-21T20:00:00.000Z',
      text: 'hello mail',
      changeState: 'upsert',
    });
    expect(polling.ingestion_adapter).toBe('polling');
    expect(polling.source.external_id).toBe('msg-1');

    const agent = normalizeAgentSourceEvent({
      workspaceId,
      projectId,
      agentKey: 'cursor-decision-1',
      eventType: 'agent.decision.created',
      title: 'Ship M15.1',
      text: 'source-event contract',
    });
    expect(agent.ingestion_adapter).toBe('agent');
    expect(agent.idempotency_key.startsWith('agent/')).toBe(true);

    expect(() =>
      normalizePollingSourceEvent({
        workspaceId,
        projectId: '',
        provider: 'gmail',
        externalId: 'msg-2',
        eventType: 'gmail.message.upsert',
        observedAt: '2026-08-21T20:00:00.000Z',
      }),
    ).toThrow(/project_id is required/);
  });

  it('supports deletion change_state without inventing a second logical key class', () => {
    const deleted = normalizePollingSourceEvent({
      workspaceId,
      projectId,
      provider: 'google-drive',
      accountId,
      externalId: 'file-1',
      externalVersion: 'rev-2',
      eventType: 'drive.file.deleted',
      observedAt: '2026-08-21T20:00:00.000Z',
      changeState: 'delete',
      text: 'tombstone',
    });
    expect(deleted.change_state).toBe('delete');
    expect(deleted.idempotency_key).toContain('file-1@rev-2');
  });
});

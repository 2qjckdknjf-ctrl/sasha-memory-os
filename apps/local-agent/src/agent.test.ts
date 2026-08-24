import { describe, expect, it } from 'vitest';
import {
  enqueue,
  loadConfig,
  readQueue,
  writeQueue,
  type AgentConfig,
} from './agent.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempConfig(): AgentConfig {
  const dir = mkdtempSync(join(tmpdir(), 'memory-os-agent-'));
  return { ...loadConfig({ MEMORY_OS_LOCAL_QUEUE_DIR: dir }), queueDir: dir };
}

describe('local desktop agent queue', () => {
  it('preserves idempotency keys and rejects duplicates in queue', () => {
    const config = tempConfig();
    enqueue(config, { idempotencyKey: 'k1', title: 't', text: 'body' });
    enqueue(config, { idempotencyKey: 'k1', title: 't2', text: 'body2' });
    expect(readQueue(config)).toHaveLength(1);
    rmSync(config.queueDir, { recursive: true, force: true });
  });

  it('loads explicit Memory OS project defaults', () => {
    const config = loadConfig({});
    expect(config.projectId).toBe('44444444-4444-4444-8444-444444444402');
    expect(config.actorSubjectId).toBe('33333333-3333-4333-8333-333333333303');
  });

  it('round-trips queue file', () => {
    const config = tempConfig();
    writeQueue(config, [
      {
        idempotencyKey: 'a',
        title: 'A',
        text: 'a',
        attempts: 0,
        nextAttemptAt: new Date().toISOString(),
      },
    ]);
    expect(readQueue(config)[0]?.title).toBe('A');
    rmSync(config.queueDir, { recursive: true, force: true });
  });
});

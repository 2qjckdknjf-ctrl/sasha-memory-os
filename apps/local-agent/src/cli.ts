#!/usr/bin/env node
import {
  drainQueue,
  enqueue,
  loadConfig,
  readApiSecret,
  status,
} from './agent.js';

const cmd = process.argv[2] ?? 'status';
const config = loadConfig();

async function main(): Promise<void> {
  switch (cmd) {
    case 'status':
      console.log(JSON.stringify(status(config), null, 2));
      return;
    case 'enqueue': {
      const title = process.argv[3] ?? `local-agent-${Date.now()}`;
      const key = process.argv[4] ?? title;
      enqueue(config, { title, text: `local marker ${title}`, idempotencyKey: key });
      console.log(JSON.stringify({ enqueued: key, ...status(config) }, null, 2));
      return;
    }
    case 'drain': {
      const secret = readApiSecret();
      if (!secret) {
        console.error('BLOCKED: no MEMORY_OS_API_SECRET or Keychain binding');
        process.exit(2);
      }
      const result = await drainQueue(config, secret);
      console.log(JSON.stringify({ ...result, ...status(config) }, null, 2));
      return;
    }
    default:
      console.error('usage: memory-os-local-agent [status|enqueue|drain]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

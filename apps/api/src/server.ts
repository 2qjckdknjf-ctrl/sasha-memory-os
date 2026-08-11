import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from './supabase.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const env = loadMemoryOsEnv();
const gateway = env
  ? new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret)
  : null;

const app = createApp({ gateway });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `memory-api listening on http://localhost:${info.port} backend=${gateway ? 'supabase' : 'memory-store'}`,
  );
});

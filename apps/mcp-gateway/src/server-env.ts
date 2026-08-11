import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import { createMcpHandlers } from './tools.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
config({ path: resolve(root, '.env') });

const env = loadMemoryOsEnv();
const gateway = env
  ? new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret)
  : null;

export const mcpRuntime = createMcpHandlers({ gateway });

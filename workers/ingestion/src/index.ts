import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';
import { chunkText } from './chunk.js';

export const packageName = 'worker-ingestion' as const;
export { chunkText };

/** Process a single ingest job via trusted API RPCs (text path). */
export async function processIngestJob(jobId: string, subjectId: string) {
  const env = loadMemoryOsEnv();
  if (!env) {
    throw new Error('MEMORY_OS_* env required for ingestion worker');
  }
  const gateway = new SupabaseMemoryGateway(
    createMemoryOsClient(env),
    env.apiSecret,
  );
  return gateway.processIngestJob(subjectId, jobId);
}

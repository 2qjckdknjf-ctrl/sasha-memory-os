import { processIngestJob } from './index.js';

const jobId = process.argv[2];
const subjectId =
  process.argv[3] ?? '33333333-3333-4333-8333-333333333301';

if (!jobId) {
  console.log(
    'Usage: pnpm --filter @memory-os/worker-ingestion start <jobId> [subjectId]',
  );
  process.exit(0);
}

const result = await processIngestJob(jobId, subjectId);
console.log(JSON.stringify(result, null, 2));

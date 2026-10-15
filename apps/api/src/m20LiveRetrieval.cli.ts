import { runM20LiveReadOnlyRetrieval } from './m20LiveRetrieval.js';

async function main(): Promise<void> {
  const report = await runM20LiveReadOnlyRetrieval({
    client: { request: fetch },
    baseUrl: process.env.MEMORY_OS_API_BASE_URL ?? '',
    apiSecret: process.env.MEMORY_OS_API_SECRET ?? '',
    projectId: process.env.MEMORY_OS_PROJECT_ID ?? '',
  });
  if (!report.ok) {
    throw new Error(
      `live retrieval gate failed samples=${report.samples} failed=${report.failed} p95_ms=${report.p95Ms} threshold_ms=${report.thresholdMs}`,
    );
  }
  console.log(
    `m20_live_retrieval=pass samples=${report.samples} failed=0 p95_ms=${report.p95Ms} threshold_ms=${report.thresholdMs} read_only=true payload_logged=false`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

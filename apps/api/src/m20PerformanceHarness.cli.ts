import { runM20PerformanceSoak } from './m20PerformanceHarness.js';

async function main(): Promise<void> {
  const report = await runM20PerformanceSoak(
    { request: fetch },
    {
      baseUrl: process.env.MEMORY_OS_API_BASE_URL,
      projectId: process.env.MEMORY_OS_PROJECT_ID,
      workspaceId: process.env.MEMORY_OS_WORKSPACE_ID,
      apiSecret: process.env.MEMORY_OS_API_SECRET,
      idempotencyNamespace: process.env.MEMORY_OS_M20_IDEMPOTENCY_NAMESPACE,
      waves: process.env.MEMORY_OS_M20_SOAK_WAVES
        ? Number(process.env.MEMORY_OS_M20_SOAK_WAVES)
        : undefined,
    },
  );
  if (!report.assertions.ok) {
    throw new Error(report.assertions.errors.join('; '));
  }
  console.log(
    [
      'm20_performance_soak=pass',
      `operations=${report.totalOperations}`,
      `api_failures=${report.apiFailures}`,
      `mcp_failures=${report.mcpFailures}`,
      `hybrid_p95_ms=${report.targets['search.hybrid'].p95Ms}`,
      `project_state_p95_ms=${report.targets['project.state'].p95Ms}`,
      `write_receipt_p95_ms=${report.targets['write.receipt'].p95Ms}`,
      'payload_logged=false',
    ].join(' '),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

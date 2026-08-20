import {
  assertBoundedSoakReport,
  boundedSoakConfigInputFromEnv,
  resolveBoundedSoakConfig,
  runBoundedSoakRecipe,
  type BoundedSoakConfigInput,
} from './soakHarness.js';

function usage(): string {
  return [
    'Usage:',
    '  npx tsx apps/api/src/soakHarness.cli.ts [options]',
    '',
    'Options:',
    '  --base-url <url>        API base URL (default http://localhost:8787)',
    '  --project-id <uuid>     Explicit project_id for read/write paths (required)',
    '  --workspace-id <uuid>   Workspace UUID override',
    '  --concurrency <n>       Bounded concurrency (max 3)',
    '  --rounds <n>            Bounded rounds (max 2)',
    '  --timeout-ms <n>        Per-request timeout ms (max 4000)',
    '  --help                  Show this message',
    '',
    'Env alternatives:',
    '  MEMORY_OS_API_BASE_URL, MEMORY_OS_SOAK_PROJECT_ID or MEMORY_OS_PROJECT_ID,',
    '  MEMORY_OS_WORKSPACE_ID, MEMORY_OS_API_SECRET, MEMORY_OS_SOAK_CONCURRENCY,',
    '  MEMORY_OS_SOAK_ROUNDS, MEMORY_OS_SOAK_TIMEOUT_MS',
  ].join('\n');
}

function parseArgs(argv: string[]): BoundedSoakConfigInput | 'help' {
  const input: BoundedSoakConfigInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help') return 'help';
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    switch (arg) {
      case '--base-url':
        input.baseUrl = next;
        index += 1;
        break;
      case '--project-id':
        input.projectId = next;
        index += 1;
        break;
      case '--workspace-id':
        input.workspaceId = next;
        index += 1;
        break;
      case '--concurrency':
        input.concurrency = Number(next);
        index += 1;
        break;
      case '--rounds':
        input.rounds = Number(next);
        index += 1;
        break;
      case '--timeout-ms':
        input.requestTimeoutMs = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return input;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(usage());
    return;
  }
  const envInput = boundedSoakConfigInputFromEnv(process.env);
  const merged = resolveBoundedSoakConfig({
    ...envInput,
    ...parsed,
    apiSecret: process.env.MEMORY_OS_API_SECRET,
  });
  const report = await runBoundedSoakRecipe(
    { request: globalThis.fetch.bind(globalThis) },
    merged,
  );
  assertBoundedSoakReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

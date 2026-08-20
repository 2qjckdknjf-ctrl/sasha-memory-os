import {
  privacySlaDrillConfigInputFromEnv,
  runPrivacySlaDrill,
  type PrivacySlaDrillConfigInput,
} from './privacySlaDrill.js';

function usage(): string {
  return [
    'Usage:',
    '  npx tsx apps/api/src/privacySlaDrill.cli.ts [options]',
    '',
    'Options:',
    '  --fixture-dir <path>      Fixture directory (default local m14-s06-v1 fixture)',
    '  --manifest-path <path>    Override sla-manifest.json path',
    '  --project-id <uuid>       Explicit project_id required for the bounded drill',
    '  --workspace-id <uuid>     Workspace UUID override',
    '  --help                    Show this message',
    '',
    'Env alternatives:',
    '  MEMORY_OS_PRIVACY_SLA_FIXTURE_DIR, MEMORY_OS_PRIVACY_SLA_MANIFEST_PATH,',
    '  MEMORY_OS_PRIVACY_SLA_PROJECT_ID or MEMORY_OS_PROJECT_ID, MEMORY_OS_WORKSPACE_ID',
  ].join('\n');
}

function parseArgs(argv: string[]): PrivacySlaDrillConfigInput | 'help' {
  const input: PrivacySlaDrillConfigInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === '--help') return 'help';
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    switch (arg) {
      case '--fixture-dir':
        input.fixtureDir = next;
        index += 1;
        break;
      case '--manifest-path':
        input.manifestPath = next;
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
  const merged: PrivacySlaDrillConfigInput = {
    ...privacySlaDrillConfigInputFromEnv(process.env),
    ...parsed,
  };
  const report = await runPrivacySlaDrill(merged);
  if (!report.assertions.ok) {
    throw new Error(report.assertions.errors.join('; '));
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

import {
  restoreDrillConfigInputFromEnv,
  runRestoreDrillRecipe,
  type RestoreDrillConfigInput,
} from './restoreDrill.js';

function usage(): string {
  return [
    'Usage:',
    '  npx tsx apps/api/src/restoreDrill.cli.ts [options]',
    '',
    'Options:',
    '  --fixture-dir <path>          Fixture directory (default local m14-s04-v1 fixture)',
    '  --project-id <uuid>           Explicit project_id when owner export evidence is present',
    '  --workspace-id <uuid>         Workspace UUID override',
    '  --export-evidence-path <path> Override owner export evidence path',
    '  --help                        Show this message',
    '',
    'Env alternatives:',
    '  MEMORY_OS_DR_RESTORE_FIXTURE_DIR, MEMORY_OS_DR_RESTORE_PROJECT_ID or MEMORY_OS_PROJECT_ID,',
    '  MEMORY_OS_WORKSPACE_ID, MEMORY_OS_DR_RESTORE_EXPORT_EVIDENCE_PATH',
  ].join('\n');
}

function parseArgs(argv: string[]): RestoreDrillConfigInput | 'help' {
  const input: RestoreDrillConfigInput = {};
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
      case '--project-id':
        input.projectId = next;
        index += 1;
        break;
      case '--workspace-id':
        input.workspaceId = next;
        index += 1;
        break;
      case '--export-evidence-path':
        input.exportEvidencePath = next;
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
  const merged: RestoreDrillConfigInput = {
    ...restoreDrillConfigInputFromEnv(process.env),
    ...parsed,
  };
  const report = await runRestoreDrillRecipe(merged);
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

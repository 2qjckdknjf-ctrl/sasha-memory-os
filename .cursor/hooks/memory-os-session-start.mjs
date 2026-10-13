#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PACK_VERSION = 'm18-s01-v1';
const PROJECT_ID = '44444444-4444-4444-8444-444444444402';
const projectDir = process.env.CURSOR_PROJECT_DIR || process.cwd();

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unavailable';
  }
}

let input = '';
for await (const chunk of process.stdin) input += String(chunk);
let sessionId = 'unknown';
try {
  const payload = JSON.parse(input || '{}');
  sessionId = String(payload.session_id ?? payload.conversation_id ?? 'unknown');
} catch {
  // Hook context is still useful when Cursor provides malformed/empty input.
}

const snapshot = {
  head: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']),
  originMain: git(['rev-parse', 'origin/main']),
  workingTree: git(['status', '--short']) || 'clean',
};

const additionalContext = [
  `Sasha Memory OS Cursor bootstrap contract ${PACK_VERSION} is mandatory for every substantial task.`,
  `Canonical project: ${PROJECT_ID}.`,
  'Before editing run: node scripts/cursor-mcp-session.mjs bootstrap --project-id 44444444-4444-4444-8444-444444444402',
  'Then follow A–G: search canonical/current memory; inspect origin/main/worktree; bound one slice; implement/test; PR+CI+merge; write milestone; verify automatic read-after-write.',
  'Do not use a default project fallback or claim completion without readAfterWrite.verified=true.',
  `Session snapshot: branch=${snapshot.branch}; HEAD=${snapshot.head}; origin/main=${snapshot.originMain}; worktree=${snapshot.workingTree}.`,
].join('\n');

process.stdout.write(
  JSON.stringify({
    env: {
      MEMORY_OS_CURSOR_BOOTSTRAP_VERSION: PACK_VERSION,
      MEMORY_OS_CURSOR_PROJECT_ID: PROJECT_ID,
      MEMORY_OS_CURSOR_SESSION_ID: sessionId,
    },
    additional_context: additionalContext,
  }),
);

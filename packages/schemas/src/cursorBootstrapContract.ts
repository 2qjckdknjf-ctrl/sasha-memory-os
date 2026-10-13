export const OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK_VERSION = 'm18-s01-v1' as const;

export const CURSOR_BOOTSTRAP_STEPS = [
  {
    id: 'A',
    key: 'memory-bootstrap',
    requirement: 'Search the canonical completion plan and current project context.',
  },
  {
    id: 'B',
    key: 'git-inspection',
    requirement: 'Inspect fresh origin/main, HEAD, branch and working tree.',
  },
  {
    id: 'C',
    key: 'bounded-slice',
    requirement: 'Define one bounded execution slice and acceptance evidence.',
  },
  {
    id: 'D',
    key: 'implementation-verification',
    requirement: 'Implement and run proportionate verification.',
  },
  {
    id: 'E',
    key: 'pull-request',
    requirement: 'Create, review, verify and merge one pull request.',
  },
  {
    id: 'F',
    key: 'milestone-writeback',
    requirement: 'Write the merged milestone, blockers and next slice to Memory OS.',
  },
  {
    id: 'G',
    key: 'read-after-write',
    requirement: 'Read the milestone by returned id and verify exact scope/content.',
  },
] as const;

export const OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK = {
  version: OFFICIAL_M18_CURSOR_BOOTSTRAP_PACK_VERSION,
  roadmapSections: ['18', 'cursor-bootstrap', 'shared-agent-lifecycle'],
  steps: CURSOR_BOOTSTRAP_STEPS,
  invariants: {
    substantialTasksRunAllStepsInOrder: true,
    explicitCanonicalProjectRequired: true,
    canonicalPlanSearchRequired: true,
    currentContextSearchRequired: true,
    freshOriginMainInspectionRequired: true,
    oneBoundedSlicePerPullRequest: true,
    mergeBeforeProductionChange: true,
    mergeBeforeMilestoneWrite: true,
    uniqueIdempotencyKeyRequired: true,
    readAfterWriteRequired: true,
    noDefaultProjectFallback: true,
  },
  cursor: {
    alwaysOnRule: '.cursor/rules/memory-os-lifecycle.mdc',
    sessionHook: '.cursor/hooks.json',
    workflow: 'scripts/cursor-mcp-session.mjs',
  },
} as const;

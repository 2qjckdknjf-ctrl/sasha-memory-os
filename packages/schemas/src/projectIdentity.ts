/**
 * Canonical workspace/project/subject UUIDs for Sasha Memory OS.
 * AISTROYKA and Sasha Memory OS are distinct projects — never share one UUID.
 */

export const CANONICAL_WORKSPACE_ID =
  '11111111-1111-4111-8111-111111111111' as const;

/** AISTROYKA product project (unchanged from original seed). */
export const AISTROYKA_PROJECT_ID =
  '44444444-4444-4444-8444-444444444401' as const;

/** Sasha Memory OS monorepo — shared ChatGPT↔Cursor engineering memory. */
export const SASHA_MEMORY_OS_PROJECT_ID =
  '44444444-4444-4444-8444-444444444402' as const;

/** HiAir product project — isolated from Memory OS and AISTROYKA. */
export const HIAIR_PROJECT_ID =
  '44444444-4444-4444-8444-444444444403' as const;

/** Default explicit project for shared-memory acceptance and CURRENT_STATE. */
export const CANONICAL_PROJECT_ID = SASHA_MEMORY_OS_PROJECT_ID;

export const OWNER_SUBJECT_ID =
  '33333333-3333-4333-8333-333333333301' as const;
export const CHATGPT_SUBJECT_ID =
  '33333333-3333-4333-8333-333333333302' as const;
export const CURSOR_SUBJECT_ID =
  '33333333-3333-4333-8333-333333333303' as const;
export const ROMA_SUBJECT_ID =
  '33333333-3333-4333-8333-333333333304' as const;

export type ProjectRoutingClassification =
  | 'KEEP_AISTROYKA'
  | 'MOVE_TO_MEMORY_OS'
  | 'MOVE_TO_HIAIR'
  | 'UNCLASSIFIED'
  | 'REVIEW_REQUIRED';

export const PROJECT_ID_BY_SLUG: Readonly<Record<string, string>> = {
  aistroyka: AISTROYKA_PROJECT_ID,
  ais: AISTROYKA_PROJECT_ID,
  'sasha-memory-os': SASHA_MEMORY_OS_PROJECT_ID,
  'memory-os': SASHA_MEMORY_OS_PROJECT_ID,
  memory_os: SASHA_MEMORY_OS_PROJECT_ID,
  hiair: HIAIR_PROJECT_ID,
};

export const OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION =
  'p0-project-identity-v1' as const;

export const OFFICIAL_P0_PROJECT_IDENTITY_PACK = {
  version: OFFICIAL_P0_PROJECT_IDENTITY_PACK_VERSION,
  workspaceId: CANONICAL_WORKSPACE_ID,
  projects: {
    aistroyka: AISTROYKA_PROJECT_ID,
    sashaMemoryOs: SASHA_MEMORY_OS_PROJECT_ID,
    hiair: HIAIR_PROJECT_ID,
  },
  actors: {
    owner: OWNER_SUBJECT_ID,
    chatgpt: CHATGPT_SUBJECT_ID,
    cursor: CURSOR_SUBJECT_ID,
    roma: ROMA_SUBJECT_ID,
  },
  invariants: {
    neverUseDefaultProjectFallback: true,
    neverUseAistroykaFallback: true,
    writesRequireExplicitProjectId: true,
    oneUuidPerProject: true,
  },
} as const;

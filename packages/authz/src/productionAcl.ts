import type { AclEntry } from './index.js';
import {
  AISTROYKA_PROJECT_ID,
  CHATGPT_SUBJECT_ID,
  CURSOR_SUBJECT_ID,
  HIAIR_PROJECT_ID,
  SASHA_MEMORY_OS_PROJECT_ID,
} from '@memory-os/schemas';

const memoryOs = SASHA_MEMORY_OS_PROJECT_ID;
const aistroyka = AISTROYKA_PROJECT_ID;
const hiair = HIAIR_PROJECT_ID;

/** Production ChatGPT/Cursor ACL — SQL seed + P0 migration source of truth. */
export function buildProductionAgentAclEntries(): AclEntry[] {
  return [
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project',
      projectId: memoryOs,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project_state',
      projectId: memoryOs,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'handoff',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project_state',
      projectId: aistroyka,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project',
      projectId: memoryOs,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project_state',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'handoff',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'session',
      projectId: memoryOs,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
  ];
}

/** Legacy upgraded DB: seed + m8 backfill before P0 remediation. */
export function buildLegacyPreP0AclEntries(): AclEntry[] {
  const legacy: AclEntry[] = [
    // seed.sql ChatGPT on AISTROYKA
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project',
      projectId: aistroyka,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project_state',
      projectId: aistroyka,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    // seed.sql Cursor read-only on AISTROYKA (superseded by m8 write grant)
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: aistroyka,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project',
      projectId: aistroyka,
      actions: ['read'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'project_state',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'handoff',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'session',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    // m8_slice_03 backfill: Cursor memory read+write on AISTROYKA
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: aistroyka,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    // m8 workspace-wide grants (fail-closed violation pre-P0)
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: null,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CHATGPT_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'handoff',
      projectId: null,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'memory',
      projectId: null,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
    {
      subjectId: CURSOR_SUBJECT_ID,
      effect: 'allow',
      resourceType: 'handoff',
      projectId: null,
      actions: ['read', 'write'],
      sensitivityMax: 'internal',
    },
  ];
  return legacy;
}

const CURSOR_LEGACY_AISTROYKA_RESOURCES = new Set([
  'memory',
  'project',
  'project_state',
  'handoff',
  'session',
]);

/** Mirrors P0 migration DELETE + INSERT remediation (idempotent). */
export function applyP0AclRemediation(entries: AclEntry[]): AclEntry[] {
  const cursor = CURSOR_SUBJECT_ID;
  const chatgpt = CHATGPT_SUBJECT_ID;
  const wsAgents = new Set<string>([cursor, chatgpt]);

  const filtered = entries.filter((entry) => {
    if (entry.effect !== 'allow') return true;
    if (
      entry.subjectId === cursor &&
      entry.projectId === aistroyka &&
      CURSOR_LEGACY_AISTROYKA_RESOURCES.has(entry.resourceType)
    ) {
      return false;
    }
    if (
      wsAgents.has(entry.subjectId) &&
      entry.projectId === null &&
      (entry.resourceType === 'memory' || entry.resourceType === 'handoff')
    ) {
      return false;
    }
    return true;
  });

  const key = (e: AclEntry) =>
    `${e.subjectId}|${e.effect}|${e.resourceType}|${e.projectId ?? 'null'}|${e.actions.join(',')}`;

  const merged = new Map<string, AclEntry>();
  for (const entry of filtered) merged.set(key(entry), entry);
  for (const entry of buildProductionAgentAclEntries()) merged.set(key(entry), entry);

  return [...merged.values()];
}

export const P0_ACL_TEST_PROJECTS = {
  memoryOs,
  aistroyka,
  hiair,
} as const;

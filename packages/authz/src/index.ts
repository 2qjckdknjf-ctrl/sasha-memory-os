import { sensitivityRank, type Sensitivity } from '@memory-os/domain';

export const packageName = 'authz' as const;
export * from './subjects.js';

export type AclEffect = 'allow' | 'deny';

export interface AclEntry {
  subjectId: string;
  effect: AclEffect;
  resourceType: string;
  projectId: string | null;
  actions: string[];
  sensitivityMax: Sensitivity | null;
}

export interface AuthzContext {
  subjectId: string;
  workspaceId: string;
  isOwner: boolean;
  entries: AclEntry[];
}

export function authorize(
  ctx: AuthzContext,
  input: {
    resourceType: string;
    action: string;
    projectId?: string | null;
    sensitivity?: Sensitivity;
  },
): boolean {
  const sensitivity = input.sensitivity ?? 'internal';
  const projectId = input.projectId ?? null;

  const denied = ctx.entries.some(
    (e) =>
      e.subjectId === ctx.subjectId &&
      e.effect === 'deny' &&
      (e.resourceType === input.resourceType || e.resourceType === '*') &&
      (e.projectId === null || e.projectId === projectId) &&
      (e.actions.length === 0 || e.actions.includes(input.action)),
  );
  if (denied) return false;

  if (ctx.isOwner) return true;

  return ctx.entries.some((e) => {
    if (e.subjectId !== ctx.subjectId || e.effect !== 'allow') return false;
    if (e.resourceType !== input.resourceType && e.resourceType !== '*') {
      return false;
    }
    if (e.projectId !== null && e.projectId !== projectId) return false;
    if (e.actions.length > 0 && !e.actions.includes(input.action)) return false;
    if (
      e.sensitivityMax &&
      sensitivityRank(sensitivity) > sensitivityRank(e.sensitivityMax)
    ) {
      return false;
    }
    return true;
  });
}

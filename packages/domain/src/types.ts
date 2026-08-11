export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type SubjectId = string & { readonly __brand: 'SubjectId' };

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'idea'
  | 'decision'
  | 'task'
  | 'event'
  | 'state'
  | 'handoff';

export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'verified'
  | 'disputed'
  | 'superseded'
  | 'retracted'
  | 'deleted';

export type Sensitivity =
  | 'public'
  | 'internal'
  | 'personal'
  | 'confidential'
  | 'restricted';

export const CURRENT_TRUTH_STATUSES: readonly MemoryStatus[] = [
  'candidate',
  'active',
  'verified',
] as const;

export function isCurrentTruth(status: MemoryStatus): boolean {
  return (CURRENT_TRUTH_STATUSES as readonly string[]).includes(status);
}

export function assertNonEmptyWorkspaceId(id: string): WorkspaceId {
  if (!id.trim()) {
    throw new Error('workspace_id must be non-empty');
  }
  return id as WorkspaceId;
}

export function sensitivityRank(value: Sensitivity): number {
  switch (value) {
    case 'public':
      return 1;
    case 'internal':
      return 2;
    case 'personal':
      return 3;
    case 'confidential':
      return 4;
    case 'restricted':
      return 5;
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

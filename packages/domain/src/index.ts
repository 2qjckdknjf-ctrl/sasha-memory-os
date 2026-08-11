export const packageName = 'domain' as const;

/** Workspace id is required on every memory boundary (baseline §5.3). */
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

export function assertNonEmptyWorkspaceId(id: string): WorkspaceId {
  if (!id.trim()) {
    throw new Error('workspace_id must be non-empty');
  }
  return id as WorkspaceId;
}

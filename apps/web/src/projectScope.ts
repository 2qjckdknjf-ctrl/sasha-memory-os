import type { ProjectRecord } from './controlCenter';

export const PROJECT_FILTER_STORAGE_KEY = 'memory-os.control-center.project-filter';

export type ProjectScopeSelection = {
  routeProjectId: string | null;
  selectedProjectId: string | null;
};

type MemoriesPathInput = {
  workspaceId: string;
  projectId?: string | null;
  status?: string;
  recordedAfter?: string;
  recordedBefore?: string;
  limit?: number;
};

type SearchRequestInput = {
  query: string;
  projectId?: string | null;
  packContext: boolean;
  maxContextChars: number;
};

function setOptionalParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  if (value) {
    params.set(key, value);
  }
}

export function readStoredProjectFilter(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(PROJECT_FILTER_STORAGE_KEY)?.trim() ?? '';
  return value.length > 0 ? value : null;
}

export function persistProjectFilter(projectId: string | null) {
  if (typeof window === 'undefined') return;
  if (projectId) {
    window.localStorage.setItem(PROJECT_FILTER_STORAGE_KEY, projectId);
    return;
  }
  window.localStorage.removeItem(PROJECT_FILTER_STORAGE_KEY);
}

export function resolveReadProjectId(selection: ProjectScopeSelection): string | null {
  return selection.routeProjectId ?? selection.selectedProjectId ?? null;
}

export function resolveWriteProjectId(selection: ProjectScopeSelection): string | null {
  return selection.routeProjectId ?? selection.selectedProjectId ?? null;
}

export function shouldLoadProjectScopedContext(projectId: string | null | undefined): boolean {
  return Boolean(projectId);
}

export function requireExplicitProjectId(projectId: string | null | undefined): string {
  if (projectId) return projectId;
  throw new Error(
    'Выберите проект в каталоге или откройте карточку проекта перед записью. Global pages never default to AISTROYKA.',
  );
}

export function findProjectById(
  projects: ProjectRecord[],
  projectId: string | null | undefined,
): ProjectRecord | null {
  if (!projectId) return null;
  return projects.find((project) => project.id === projectId) ?? null;
}

export function describeProjectScope(project: ProjectRecord | null): string {
  return project?.name ?? 'всей рабочей области';
}

export function buildMemoriesPath({
  workspaceId,
  projectId = null,
  status,
  recordedAfter,
  recordedBefore,
  limit = 50,
}: MemoriesPathInput): string {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    limit: String(limit),
  });
  setOptionalParam(params, 'project_id', projectId);
  setOptionalParam(params, 'status', status);
  setOptionalParam(params, 'recorded_after', recordedAfter);
  setOptionalParam(params, 'recorded_before', recordedBefore);
  return `/v1/memories?${params.toString()}`;
}

export function buildHandoffsPath(input: {
  workspaceId: string;
  projectId?: string | null;
  limit?: number;
}): string {
  const params = new URLSearchParams({
    workspace_id: input.workspaceId,
    limit: String(input.limit ?? 50),
  });
  setOptionalParam(params, 'project_id', input.projectId ?? null);
  return `/v1/handoffs?${params.toString()}`;
}

export function buildAuditPath(input: {
  workspaceId: string;
  projectId?: string | null;
  limit?: number;
}): string {
  const params = new URLSearchParams({
    workspace_id: input.workspaceId,
    limit: String(input.limit ?? 50),
  });
  setOptionalParam(params, 'project_id', input.projectId ?? null);
  return `/v1/audit?${params.toString()}`;
}

export function buildSearchRequest(input: SearchRequestInput): {
  query: string;
  project_id?: string;
  pack_context: boolean;
  max_context_chars: number;
} {
  const body: {
    query: string;
    project_id?: string;
    pack_context: boolean;
    max_context_chars: number;
  } = {
    query: input.query,
    pack_context: input.packContext,
    max_context_chars: input.maxContextChars,
  };
  if (input.projectId) {
    body.project_id = input.projectId;
  }
  return body;
}

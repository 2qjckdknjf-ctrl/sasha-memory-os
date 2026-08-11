import {
  isCurrentTruth,
  type MemoryStatus,
  type MemoryType,
  type Sensitivity,
} from './types.js';

export interface MemoryRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  memoryType: MemoryType;
  title: string;
  content: string;
  status: MemoryStatus;
  importance: number;
  confidence: number;
  sensitivity: Sensitivity;
  validFrom: string | null;
  validTo: string | null;
  observedAt: string | null;
  recordedAt: string;
  supersededBy: string | null;
  sourceEventId: string | null;
  createdBySubject: string | null;
  schemaVersion: string;
  metadata: Record<string, unknown>;
}

export interface ProjectStateVersion {
  id: string;
  workspaceId: string;
  projectId: string;
  version: number;
  state: {
    stage: string;
    completed: string[];
    in_progress: string[];
    blocked: string[];
    next: string[];
    risks: string[];
    active_decisions: string[];
  };
  summary: string | null;
  createdBySubject: string | null;
  createdAt: string;
}

export interface Handoff {
  id: string;
  workspaceId: string;
  projectId: string;
  fromSubjectId: string | null;
  toSubjectId: string | null;
  sessionId: string | null;
  payload: {
    completed: string[];
    artifacts: Record<string, unknown>[];
    validation: string[];
    open_items: string[];
    blockers: string[];
    recommended_next: string[];
  };
  createdAt: string;
}

export function filterCurrentMemories(records: MemoryRecord[]): MemoryRecord[] {
  return records.filter((r) => isCurrentTruth(r.status));
}

export function nextProjectStateVersion(
  current: ProjectStateVersion | null,
  expectedVersion: number,
): number {
  const actual = current?.version ?? 0;
  if (actual !== expectedVersion) {
    throw new Error(
      `project state version conflict: expected ${expectedVersion}, actual ${actual}`,
    );
  }
  return actual + 1;
}

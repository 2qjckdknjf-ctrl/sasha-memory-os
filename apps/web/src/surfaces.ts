import type { Handoff, MemoryRecord, ProjectStateVersion } from '@memory-os/domain';
import { ACTOR_IDS, CHATGPT, CURSOR } from './controlCenter';

export type TaskSurfaceLane = 'memory' | 'in_progress' | 'blocked' | 'next' | 'completed';

export type TaskSurfaceItem = {
  id: string;
  title: string;
  detail: string;
  lane: TaskSurfaceLane;
  source: 'memory' | 'state';
  memoryId?: string;
  recordedAt?: string;
  status?: string;
};

export type TaskSurfaceData = {
  outstanding: TaskSurfaceItem[];
  completed: TaskSurfaceItem[];
  taskMemories: TaskSurfaceItem[];
  counts: {
    outstanding: number;
    inProgress: number;
    blocked: number;
    next: number;
    completed: number;
    memory: number;
  };
};

export type HandoffPayloadInput = {
  completed: string[];
  artifacts: Record<string, unknown>[];
  validation: string[];
  openItems: string[];
  blockers: string[];
  recommendedNext: string[];
};

export const DEFAULT_HANDOFF_PAYLOAD: HandoffPayloadInput = {
  completed: ['Loaded project context from Memory OS'],
  artifacts: [],
  validation: ['typecheck', 'unit tests'],
  openItems: ['Keep expanding control center'],
  blockers: [],
  recommendedNext: ['Wire search UX'],
};

export type HandoffSurfaceSource = 'history' | 'latest' | 'session';

export type HandoffSurfaceItem = {
  id: string;
  createdAt: string;
  fromSubjectId: string | null;
  toSubjectId: string | null;
  payload: HandoffPayloadInput;
  summary: string;
  source: HandoffSurfaceSource;
};

export type HandoffSurfaceData = {
  items: HandoffSurfaceItem[];
  latest: HandoffSurfaceItem | null;
  historyAvailable: boolean;
};

export type TaskMemoryLike = MemoryRecord | Record<string, unknown>;
export type HandoffLike = Handoff | Record<string, unknown>;

type ProjectStateSnapshot = {
  completed: string[];
  inProgress: string[];
  blocked: string[];
  next: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  const value = readField(record, keys);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTaskKey(title: string): string {
  return title.trim().toLowerCase();
}

function normalizeTaskMemory(task: TaskMemoryLike): TaskSurfaceItem | null {
  const raw = task as Record<string, unknown>;
  const memoryType = readString(raw, 'memoryType', 'memory_type');
  if (memoryType && memoryType !== 'task') return null;

  const title = readString(raw, 'title');
  if (!title) return null;

  const memoryId = readString(raw, 'id') ?? undefined;

  return {
    id: memoryId ? `task-memory:${memoryId}` : `task-memory:${normalizeTaskKey(title)}`,
    title,
    detail: readString(raw, 'content') ?? 'Запись задачи без описания.',
    lane: 'memory',
    source: 'memory',
    memoryId,
    recordedAt: readString(raw, 'recordedAt', 'recorded_at') ?? undefined,
    status: readString(raw, 'status') ?? undefined,
  };
}

function normalizeProjectState(
  stateRecord: ProjectStateVersion | Record<string, unknown> | null | undefined,
): ProjectStateSnapshot {
  if (!stateRecord) {
    return { completed: [], inProgress: [], blocked: [], next: [] };
  }

  const raw = stateRecord as Record<string, unknown>;
  const maybeNested = readField(raw, ['state']);
  const state = isRecord(maybeNested) ? maybeNested : raw;

  return {
    completed: readStringArray(readField(state, ['completed'])),
    inProgress: readStringArray(readField(state, ['in_progress', 'inProgress'])),
    blocked: readStringArray(readField(state, ['blocked'])),
    next: readStringArray(readField(state, ['next'])),
  };
}

function buildStateTaskItems(values: string[], lane: TaskSurfaceLane): TaskSurfaceItem[] {
  return values.map((value) => ({
    id: `state:${lane}:${normalizeTaskKey(value)}`,
    title: value,
    detail:
      lane === 'completed'
        ? 'Отмечено в состоянии проекта как завершенное.'
        : 'Выведено из текущего состояния проекта.',
    lane,
    source: 'state',
  }));
}

function dedupeTaskItems(items: TaskSurfaceItem[]): TaskSurfaceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeTaskKey(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeHandoffPayload(payload: HandoffPayloadInput): string {
  const summary =
    payload.recommendedNext[0] ??
    payload.openItems[0] ??
    payload.completed[0] ??
    payload.validation[0] ??
    payload.blockers[0];
  return summary ?? 'Без заметок.';
}

function normalizeHandoffPayload(value: unknown): HandoffPayloadInput {
  const raw = isRecord(value) ? value : {};
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];

  return {
    completed: readStringArray(raw.completed),
    artifacts,
    validation: readStringArray(raw.validation),
    openItems: readStringArray(readField(raw, ['open_items', 'openItems'])),
    blockers: readStringArray(raw.blockers),
    recommendedNext: readStringArray(readField(raw, ['recommended_next', 'recommendedNext'])),
  };
}

function normalizeHandoff(handoff: HandoffLike, source: HandoffSurfaceSource): HandoffSurfaceItem | null {
  const raw = handoff as Record<string, unknown>;
  const createdAt = readString(raw, 'createdAt', 'created_at');
  if (!createdAt) return null;

  const id =
    readString(raw, 'id') ??
    `${source}:${createdAt}:${readString(raw, 'fromSubjectId', 'from_subject_id') ?? 'unknown'}`;
  const payload = normalizeHandoffPayload(readField(raw, ['payload']));

  return {
    id,
    createdAt,
    fromSubjectId: readString(raw, 'fromSubjectId', 'from_subject_id'),
    toSubjectId: readString(raw, 'toSubjectId', 'to_subject_id'),
    payload,
    summary: summarizeHandoffPayload(payload),
    source,
  };
}

export function deriveTaskSurface(input: {
  taskMemories: TaskMemoryLike[];
  projectState: ProjectStateVersion | Record<string, unknown> | null | undefined;
}): TaskSurfaceData {
  const taskMemories = dedupeTaskItems(
    input.taskMemories.map((task) => normalizeTaskMemory(task)).filter((task): task is TaskSurfaceItem => task !== null),
  );
  const state = normalizeProjectState(input.projectState);
  const inProgress = buildStateTaskItems(state.inProgress, 'in_progress');
  const blocked = buildStateTaskItems(state.blocked, 'blocked');
  const next = buildStateTaskItems(state.next, 'next');
  const completed = dedupeTaskItems(buildStateTaskItems(state.completed, 'completed'));
  const outstanding = dedupeTaskItems([...taskMemories, ...inProgress, ...blocked, ...next]);

  return {
    outstanding,
    completed,
    taskMemories,
    counts: {
      outstanding: outstanding.length,
      inProgress: inProgress.length,
      blocked: blocked.length,
      next: next.length,
      completed: completed.length,
      memory: taskMemories.length,
    },
  };
}

export function deriveHandoffSurface(input: {
  latestHandoff?: HandoffLike | null;
  persistedHandoffs?: HandoffLike[];
  sessionHandoffs?: HandoffLike[];
  historyAvailable: boolean;
}): HandoffSurfaceData {
  const seed = input.historyAvailable
    ? (input.persistedHandoffs ?? []).map((handoff) => normalizeHandoff(handoff, 'history'))
    : input.latestHandoff
      ? [normalizeHandoff(input.latestHandoff, 'latest')]
      : [];
  const session = (input.sessionHandoffs ?? []).map((handoff) => normalizeHandoff(handoff, 'session'));
  const seen = new Set<string>();
  const items = [...session, ...seed]
    .filter((handoff): handoff is HandoffSurfaceItem => handoff !== null)
    .filter((handoff) => {
      if (seen.has(handoff.id)) return false;
      seen.add(handoff.id);
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    items,
    latest: items[0] ?? null,
    historyAvailable: input.historyAvailable,
  };
}

export function describeTaskLane(lane: TaskSurfaceLane): string {
  switch (lane) {
    case 'memory':
      return 'task-запись';
    case 'in_progress':
      return 'в работе';
    case 'blocked':
      return 'блокер';
    case 'next':
      return 'следом';
    case 'completed':
      return 'готово';
    default: {
      const exhaustiveCheck: never = lane;
      return exhaustiveCheck;
    }
  }
}

export function describeHandoffSource(source: HandoffSurfaceSource): string {
  switch (source) {
    case 'history':
      return 'история проекта';
    case 'latest':
      return 'последний из API';
    case 'session':
      return 'создано в этой сессии';
    default: {
      const exhaustiveCheck: never = source;
      return exhaustiveCheck;
    }
  }
}

export function describeSubject(subjectId: string | null | undefined, fallback = 'Без адресата'): string {
  if (!subjectId) return fallback;
  switch (subjectId) {
    case ACTOR_IDS.owner:
      return 'Owner';
    case CHATGPT:
      return 'ChatGPT';
    case CURSOR:
      return 'Cursor';
    default:
      return `Субъект ${subjectId.slice(0, 8)}…`;
  }
}

export function describeHandoffActors(handoff: HandoffSurfaceItem): string {
  return `${describeSubject(handoff.fromSubjectId, 'Неизвестный субъект')} → ${describeSubject(
    handoff.toSubjectId,
  )}`;
}

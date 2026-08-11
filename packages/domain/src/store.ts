import {
  filterCurrentMemories,
  nextProjectStateVersion,
  type Handoff,
  type MemoryRecord,
  type ProjectStateVersion,
} from './memory.js';

function newId(): string {
  return globalThis.crypto.randomUUID();
}

export interface SourceEvent {
  id: string;
  workspaceId: string;
  projectId: string | null;
  provider: string;
  eventType: string;
  idempotencyKey: string;
  observedAt: string;
  recordedAt: string;
  sensitivity: MemoryRecord['sensitivity'];
  payload: Record<string, unknown>;
  createdBySubject: string | null;
}

/** In-memory Memory Core for local demo slice until Postgres is wired. */
export class MemoryStore {
  readonly events = new Map<string, SourceEvent>();
  readonly eventByIdempotency = new Map<string, string>();
  readonly memories = new Map<string, MemoryRecord>();
  readonly projectStates = new Map<string, ProjectStateVersion[]>();
  readonly handoffs = new Map<string, Handoff[]>();

  ingestEvent(input: Omit<SourceEvent, 'id' | 'recordedAt'> & { id?: string }): SourceEvent {
    const idemKey = `${input.workspaceId}:${input.provider}:${input.idempotencyKey}`;
    const existingId = this.eventByIdempotency.get(idemKey);
    if (existingId) {
      const existing = this.events.get(existingId);
      if (!existing) throw new Error('idempotency index corrupt');
      return existing;
    }
    const event: SourceEvent = {
      ...input,
      id: input.id ?? newId(),
      recordedAt: new Date().toISOString(),
    };
    this.events.set(event.id, event);
    this.eventByIdempotency.set(idemKey, event.id);
    return event;
  }

  createDecision(input: {
    workspaceId: string;
    projectId: string;
    title: string;
    content: string;
    actorSubjectId: string;
    idempotencyKey: string;
    importance?: number;
    confidence?: number;
    sensitivity?: MemoryRecord['sensitivity'];
  }): MemoryRecord {
    const event = this.ingestEvent({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      provider: 'manual',
      eventType: 'memory.decision.created',
      idempotencyKey: input.idempotencyKey,
      observedAt: new Date().toISOString(),
      sensitivity: input.sensitivity ?? 'internal',
      payload: { title: input.title },
      createdBySubject: input.actorSubjectId,
    });

    const existing = [...this.memories.values()].find(
      (m) => m.sourceEventId === event.id && m.memoryType === 'decision',
    );
    if (existing) return existing;

    const record: MemoryRecord = {
      id: newId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      memoryType: 'decision',
      title: input.title,
      content: input.content,
      status: 'verified',
      importance: input.importance ?? 0.8,
      confidence: input.confidence ?? 0.9,
      sensitivity: input.sensitivity ?? 'internal',
      validFrom: new Date().toISOString(),
      validTo: null,
      observedAt: event.observedAt,
      recordedAt: new Date().toISOString(),
      supersededBy: null,
      sourceEventId: event.id,
      createdBySubject: input.actorSubjectId,
      schemaVersion: '1.0',
      metadata: {},
    };
    this.memories.set(record.id, record);
    return record;
  }

  listCurrentMemories(workspaceId: string, projectId?: string): MemoryRecord[] {
    const all = [...this.memories.values()].filter((m) => {
      if (m.workspaceId !== workspaceId) return false;
      if (projectId && m.projectId !== projectId) return false;
      return true;
    });
    return filterCurrentMemories(all);
  }

  getProjectState(projectId: string): ProjectStateVersion | null {
    const versions = this.projectStates.get(projectId) ?? [];
    return versions[versions.length - 1] ?? null;
  }

  upsertProjectState(input: {
    workspaceId: string;
    projectId: string;
    expectedVersion: number;
    state: ProjectStateVersion['state'];
    summary?: string;
    actorSubjectId: string;
  }): ProjectStateVersion {
    const current = this.getProjectState(input.projectId);
    const version = nextProjectStateVersion(current, input.expectedVersion);
    const row: ProjectStateVersion = {
      id: newId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      version,
      state: input.state,
      summary: input.summary ?? null,
      createdBySubject: input.actorSubjectId,
      createdAt: new Date().toISOString(),
    };
    const list = this.projectStates.get(input.projectId) ?? [];
    list.push(row);
    this.projectStates.set(input.projectId, list);
    return row;
  }

  createHandoff(input: {
    workspaceId: string;
    projectId: string;
    fromSubjectId: string;
    toSubjectId?: string;
    sessionId?: string;
    payload: Handoff['payload'];
  }): Handoff {
    const handoff: Handoff = {
      id: newId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fromSubjectId: input.fromSubjectId,
      toSubjectId: input.toSubjectId ?? null,
      sessionId: input.sessionId ?? null,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    const list = this.handoffs.get(input.projectId) ?? [];
    list.push(handoff);
    this.handoffs.set(input.projectId, list);
    return handoff;
  }

  latestHandoff(projectId: string): Handoff | null {
    const list = this.handoffs.get(projectId) ?? [];
    return list[list.length - 1] ?? null;
  }
}

export function createSeededStore(): MemoryStore {
  const store = new MemoryStore();
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const projectId = '44444444-4444-4444-8444-444444444401';
  const chatgpt = '33333333-3333-4333-8333-333333333302';

  const decision = store.createDecision({
    workspaceId,
    projectId,
    title: 'Порядок начала Slice 01',
    content: 'Slice 01 начинается после Product Design Audit PR #215.',
    actorSubjectId: chatgpt,
    idempotencyKey: 'manual/chatgpt/decision-slice-01',
    importance: 0.86,
    confidence: 0.99,
  });

  store.upsertProjectState({
    workspaceId,
    projectId,
    expectedVersion: 0,
    actorSubjectId: chatgpt,
    summary: 'Slice 01 ready after audit PR #215',
    state: {
      stage: 'slice-01-ready',
      completed: ['product-design-audit'],
      in_progress: [],
      blocked: [],
      next: ['implement slice 01'],
      risks: [],
      active_decisions: [decision.id],
    },
  });

  return store;
}

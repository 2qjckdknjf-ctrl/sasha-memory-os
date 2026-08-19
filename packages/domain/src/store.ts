import {
  type AuditLogEntry,
  filterCurrentMemories,
  type PrivacyRequest,
  nextProjectStateVersion,
  type Handoff,
  type MemoryRecord,
  type ProjectStateVersion,
} from './memory.js';

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  readonly auditLog: AuditLogEntry[] = [];
  readonly privacyRequests = new Map<string, PrivacyRequest>();
  readonly privacyRequestByIdempotency = new Map<string, string>();

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

  createAuditEvent(input: {
    workspaceId: string;
    actorSubjectId?: string | null;
    action: string;
    objectType?: string | null;
    objectId?: string | null;
    reason?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
  }): AuditLogEntry {
    const event: AuditLogEntry = {
      id: newId(),
      workspaceId: input.workspaceId,
      actorSubjectId: input.actorSubjectId ?? null,
      action: input.action,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      reason: input.reason ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      recordedAt: new Date().toISOString(),
    };
    this.auditLog.unshift(event);
    return event;
  }

  listAudit(workspaceId: string, limit = 50): AuditLogEntry[] {
    return this.auditLog
      .filter((entry) => entry.workspaceId === workspaceId)
      .slice(0, Math.max(1, limit));
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
      metadata: {
        source: {
          sourceEventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          observedAt: event.observedAt,
          recordedAt: event.recordedAt,
        },
        provenance: {
          origin: 'manual.decision',
          createdBySubject: input.actorSubjectId,
          sourceEventId: event.id,
        },
      },
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

  captureText(input: {
    workspaceId: string;
    projectId: string;
    title: string;
    text: string;
    actorSubjectId: string;
    idempotencyKey: string;
    sensitivity?: MemoryRecord['sensitivity'];
  }): {
    eventId: string;
    memoryId: string;
    jobId: string;
    checksum: string;
  } {
    const event = this.ingestEvent({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      provider: 'manual',
      eventType: 'capture.text.created',
      idempotencyKey: input.idempotencyKey,
      observedAt: new Date().toISOString(),
      sensitivity: input.sensitivity ?? 'internal',
      payload: {
        title: input.title,
        content: { mime_type: 'text/plain', text: input.text },
        quarantine: false,
      },
      createdBySubject: input.actorSubjectId,
    });

    const existing = [...this.memories.values()].find(
      (m) => m.sourceEventId === event.id && m.memoryType === 'fact',
    );
    if (existing) {
      return {
        eventId: event.id,
        memoryId: existing.id,
        jobId: existing.id,
        checksum: 'local',
      };
    }

    const record: MemoryRecord = {
      id: newId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      memoryType: 'fact',
      title: input.title,
      content: input.text,
      status: 'candidate',
      importance: 0.55,
      confidence: 0.6,
      sensitivity: input.sensitivity ?? 'internal',
      validFrom: null,
      validTo: null,
      observedAt: event.observedAt,
      recordedAt: new Date().toISOString(),
      supersededBy: null,
      sourceEventId: event.id,
      createdBySubject: input.actorSubjectId,
      schemaVersion: '1.0',
      metadata: {
        capture: true,
        needs_review: true,
        source: {
          sourceEventId: event.id,
          provider: event.provider,
          eventType: event.eventType,
          observedAt: event.observedAt,
          recordedAt: event.recordedAt,
          payload: event.payload,
        },
        evidence: [
          {
            kind: 'source_event',
            sourceEventId: event.id,
            observedAt: event.observedAt,
          },
        ],
        provenance: {
          origin: 'capture.text',
          createdBySubject: input.actorSubjectId,
          sourceEventId: event.id,
        },
      },
    };
    this.memories.set(record.id, record);
    return {
      eventId: event.id,
      memoryId: record.id,
      jobId: record.id,
      checksum: 'local',
    };
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
    this.createAuditEvent({
      workspaceId: input.workspaceId,
      actorSubjectId: input.fromSubjectId,
      action: 'handoff.create',
      objectType: 'handoff',
      objectId: handoff.id,
      afterState: {
        projectId: handoff.projectId,
        fromSubjectId: handoff.fromSubjectId,
        toSubjectId: handoff.toSubjectId,
        payload: handoff.payload,
      },
    });
    return handoff;
  }

  latestHandoff(projectId: string): Handoff | null {
    const list = this.handoffs.get(projectId) ?? [];
    return list[list.length - 1] ?? null;
  }

  listHandoffs(projectId?: string | null, limit = 50): Handoff[] {
    const list = projectId
      ? [...(this.handoffs.get(projectId) ?? [])]
      : [...this.handoffs.values()].flat();
    return list
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit));
  }

  createPrivacyRequest(input: {
    workspaceId: string;
    projectId?: string | null;
    actorSubjectId: string;
    requestType: PrivacyRequest['requestType'];
    targetMemoryId?: string | null;
    reason: string;
    correctionText?: string | null;
    idempotencyKey: string;
  }): PrivacyRequest {
    const idemKey = `${input.workspaceId}:${input.idempotencyKey}`;
    const existingId = this.privacyRequestByIdempotency.get(idemKey);
    if (existingId) {
      const existing = this.privacyRequests.get(existingId);
      if (!existing) throw new Error('privacy request index corrupt');
      return existing;
    }
    const request: PrivacyRequest = {
      id: newId(),
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      actorSubjectId: input.actorSubjectId,
      requestType: input.requestType,
      status: 'submitted',
      targetMemoryId: input.targetMemoryId ?? null,
      reason: input.reason,
      correctionText: input.correctionText ?? null,
      createdAt: new Date().toISOString(),
    };
    this.privacyRequests.set(request.id, request);
    this.privacyRequestByIdempotency.set(idemKey, request.id);
    this.createAuditEvent({
      workspaceId: input.workspaceId,
      actorSubjectId: input.actorSubjectId,
      action: 'privacy.request.submitted',
      objectType: 'privacy_request',
      objectId: request.id,
      reason: input.reason,
      afterState: {
        requestType: request.requestType,
        targetMemoryId: request.targetMemoryId,
        projectId: request.projectId,
        status: request.status,
      },
    });
    return request;
  }

  listPrivacyRequests(workspaceId: string, limit = 50): PrivacyRequest[] {
    return [...this.privacyRequests.values()]
      .filter((request) => request.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, limit));
  }

  setMemoryStatus(input: {
    memoryId: string;
    status: MemoryRecord['status'];
    reason: string;
    actorSubjectId: string;
  }): MemoryRecord {
    const current = this.memories.get(input.memoryId);
    if (!current) throw new Error('memory not found');
    const statusAt = new Date().toISOString();
    const next: MemoryRecord = {
      ...current,
      status: input.status,
      metadata: {
        ...current.metadata,
        status_reason: input.reason,
        status_actor: input.actorSubjectId,
        status_at: statusAt,
      },
    };
    this.memories.set(next.id, next);
    this.createAuditEvent({
      workspaceId: next.workspaceId,
      actorSubjectId: input.actorSubjectId,
      action: 'memory.set_status',
      objectType: 'memory',
      objectId: next.id,
      reason: input.reason,
      beforeState: { status: current.status, projectId: current.projectId },
      afterState: {
        status: next.status,
        reason: input.reason,
        statusAt,
        projectId: next.projectId,
      },
    });
    return next;
  }

  correctMemory(input: {
    memoryId: string;
    reason: string;
    actorSubjectId: string;
    title?: string;
    content?: string;
    replacementMemoryId?: string;
  }): { superseded: MemoryRecord; authoritative: MemoryRecord } {
    const current = this.memories.get(input.memoryId);
    if (!current) throw new Error('memory not found');
    if (current.status === 'superseded') {
      throw new Error('superseded memory cannot be corrected');
    }
    if (current.status === 'deleted') {
      throw new Error('deleted memory cannot be corrected');
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error('reason required');
    const correctionAt = new Date().toISOString();
    const priorProvenance = isRecord(current.metadata.provenance)
      ? current.metadata.provenance
      : {};

    let authoritative: MemoryRecord;
    if (input.replacementMemoryId) {
      if (input.replacementMemoryId === input.memoryId) {
        throw new Error('replacement memory must differ');
      }
      const existingReplacement = this.memories.get(input.replacementMemoryId);
      if (!existingReplacement) throw new Error('replacement memory not found');
      if (existingReplacement.workspaceId !== current.workspaceId) {
        throw new Error('workspace mismatch');
      }
      if (existingReplacement.projectId !== current.projectId) {
        throw new Error('project mismatch');
      }
      if (existingReplacement.status === 'superseded') {
        throw new Error('superseded replacement memory cannot become authoritative');
      }
      authoritative = {
        ...existingReplacement,
        status: 'verified',
        metadata: {
          ...existingReplacement.metadata,
          status_reason: reason,
          status_actor: input.actorSubjectId,
          status_at: correctionAt,
          corrected_from: current.id,
          correction_reason: reason,
          correction_actor: input.actorSubjectId,
          correction_at: correctionAt,
          provenance: {
            ...(isRecord(existingReplacement.metadata.provenance)
              ? existingReplacement.metadata.provenance
              : {}),
            origin: 'memory.correction',
            correctedFromMemoryId: current.id,
            correctedBySubject: input.actorSubjectId,
            correctionReason: reason,
            correctionAt,
          },
        },
      };
    } else {
      if (!input.content) {
        throw new Error('content is required when replacement memory is not provided');
      }
      authoritative = {
        ...current,
        id: newId(),
        title: input.title ?? current.title,
        content: input.content,
        status: 'verified',
        recordedAt: correctionAt,
        supersededBy: null,
        createdBySubject: input.actorSubjectId,
        metadata: {
          ...current.metadata,
          status_reason: reason,
          status_actor: input.actorSubjectId,
          status_at: correctionAt,
          corrected_from: current.id,
          correction_reason: reason,
          correction_actor: input.actorSubjectId,
          correction_at: correctionAt,
          provenance: {
            ...priorProvenance,
            origin: 'memory.correction',
            correctedFromMemoryId: current.id,
            correctedBySubject: input.actorSubjectId,
            correctionReason: reason,
            correctionAt,
            previousCreatedBySubject: current.createdBySubject,
            previousSourceEventId: current.sourceEventId,
          },
        },
      };
    }

    const superseded: MemoryRecord = {
      ...current,
      status: 'superseded',
      supersededBy: authoritative.id,
      metadata: {
        ...current.metadata,
        status_reason: reason,
        status_actor: input.actorSubjectId,
        status_at: correctionAt,
        corrected_by: authoritative.id,
        correction_reason: reason,
        correction_actor: input.actorSubjectId,
        correction_at: correctionAt,
      },
    };

    this.memories.set(superseded.id, superseded);
    this.memories.set(authoritative.id, authoritative);
    this.createAuditEvent({
      workspaceId: current.workspaceId,
      actorSubjectId: input.actorSubjectId,
      action: 'memory.correct',
      objectType: 'memory',
      objectId: superseded.id,
      reason,
      beforeState: {
        memoryId: current.id,
        status: current.status,
        title: current.title,
        content: current.content,
        projectId: current.projectId,
      },
      afterState: {
        supersededId: superseded.id,
        authoritativeId: authoritative.id,
        supersededStatus: superseded.status,
        authoritativeStatus: authoritative.status,
        reason,
        projectId: current.projectId,
      },
    });
    return { superseded, authoritative };
  }

  supersedeMemory(input: {
    duplicateId: string;
    keeperId: string;
    reason: string;
    actorSubjectId: string;
  }): MemoryRecord {
    if (input.duplicateId === input.keeperId) {
      throw new Error('duplicate and keeper must differ');
    }
    const duplicate = this.memories.get(input.duplicateId);
    const keeper = this.memories.get(input.keeperId);
    if (!duplicate || !keeper) throw new Error('memory not found');
    const nextDup: MemoryRecord = {
      ...duplicate,
      status: 'superseded',
      supersededBy: keeper.id,
      metadata: {
        ...duplicate.metadata,
        status_reason: input.reason,
        status_actor: input.actorSubjectId,
        status_at: new Date().toISOString(),
        consolidated_into: keeper.id,
      },
    };
    const from = Array.isArray(keeper.metadata.consolidated_from)
      ? [...(keeper.metadata.consolidated_from as string[])]
      : [];
    from.push(duplicate.id);
    const nextKeeper: MemoryRecord = {
      ...keeper,
      metadata: {
        ...keeper.metadata,
        consolidated_from: from,
        consolidated_at: new Date().toISOString(),
      },
    };
    this.memories.set(nextDup.id, nextDup);
    this.memories.set(nextKeeper.id, nextKeeper);
    this.createAuditEvent({
      workspaceId: duplicate.workspaceId,
      actorSubjectId: input.actorSubjectId,
      action: 'memory.supersede',
      objectType: 'memory',
      objectId: duplicate.id,
      reason: input.reason,
      afterState: {
        duplicateId: duplicate.id,
        keeperId: keeper.id,
        status: 'superseded',
        projectId: duplicate.projectId,
      },
    });
    return nextDup;
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

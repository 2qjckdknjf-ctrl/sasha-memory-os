import { useCallback, useEffect, useMemo, useState } from 'react';
import { matchPath, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { createSeededStore } from '@memory-os/domain';
import {
  packSearchContext as packSearchContextLocal,
  searchMemoriesHybrid as searchMemoriesHybridLocal,
} from '@memory-os/retrieval';
import { apiGet, apiHealth, apiPatch, apiPost, setBoundAuthUserId } from './api';
import { AgentScopesPage } from './AgentScopesPage';
import { AppShell } from './AppShell';
import { AuthPanel } from './AuthPanel';
import { AuditPage } from './AuditPage';
import { ConflictsPage } from './ConflictsPage';
import { ConnectionsPage } from './ConnectionsPage';
import { HandoffsPage } from './HandoffsPage';
import { HomePage } from './HomePage';
import { MemoryInspectorPage } from './MemoryInspectorPage';
import { OpsPage } from './OpsPage';
import { PrivacyPage } from './PrivacyPage';
import { ProjectScopePanel } from './ProjectScopePanel';
import { ProjectsPage } from './ProjectsPage';
import { storePendingOAuthSession } from './oauthSession';
import { ProjectPage } from './ProjectPage';
import {
  buildHandoffsPath,
  buildMemoriesPath,
  buildSearchRequest,
  describeProjectScope,
  findProjectById,
  persistProjectFilter,
  readStoredProjectFilter,
  requireExplicitProjectId,
  resolveReadProjectId,
  resolveWriteProjectId,
} from './projectScope';
import { SearchPage } from './SearchPage';
import { TasksPage } from './TasksPage';
import {
  type AgentActor,
  ACTOR_IDS,
  ACTOR_LABELS,
  CURSOR,
  PROJECT_ID,
  WORKSPACE_ID,
  type Actor,
  type BackendMode,
  type ConnectionHealthRecord,
  type ConnectionRecord,
  type ConnectorDefinitionRecord,
  type CorrectMemoryPayload,
  type ExtractionCandidate,
  type MeResponse,
  type MemoryStatusAction,
  type OutboxPendingItem,
  type ProjectRecord,
  type RemoteContext,
  type ReviewQueueItem,
  type SearchContext,
  type SearchHit,
  type StateSummary,
  type TimelineEntry,
} from './controlCenter';
import {
  DEFAULT_HANDOFF_PAYLOAD,
  deriveHandoffSurface,
  deriveTaskSurface,
  type HandoffLike,
  type HandoffPayloadInput,
} from './surfaces';

export function App() {
  const [localStore] = useState(() => createSeededStore());
  const [actor, setActor] = useState<Actor>('owner');
  const [backend, setBackend] = useState<BackendMode>('local');
  const [backendResolved, setBackendResolved] = useState(false);
  const [search, setSearch] = useState('Slice');
  const [packContext, setPackContext] = useState(false);
  const [searchContext, setSearchContext] = useState<SearchContext | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [title, setTitle] = useState('Continue remediation after audit');
  const [content, setContent] = useState(
    'Next engineering work follows the Slice 01 kickoff decision.',
  );
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorDefinitionRecord[]>([]);
  const [connectionHealth, setConnectionHealth] = useState<Record<string, ConnectionHealthRecord>>(
    {},
  );
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [captureTitle, setCaptureTitle] = useState('Meeting note');
  const [captureText, setCaptureText] = useState(
    'Manual capture alpha: quarantine → hash → chunks → candidate memory.',
  );
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState('Uploaded brief');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState('https://example.com');
  const [linkTitle, setLinkTitle] = useState('Linked note');
  const [boundSubjectId, setBoundSubjectId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [outboxPending, setOutboxPending] = useState<OutboxPendingItem[]>([]);
  const [scopedMemories, setScopedMemories] = useState<Array<Record<string, unknown>>>([]);
  const [jobLookupId, setJobLookupId] = useState('');
  const [jobLookup, setJobLookup] = useState<Record<string, unknown> | null>(null);
  const [extractionPreview, setExtractionPreview] = useState<string | null>(null);
  const [extractionCandidates, setExtractionCandidates] = useState<ExtractionCandidate[]>(
    [],
  );
  const [extractionSelected, setExtractionSelected] = useState<Set<number>>(
    () => new Set(),
  );
  const [sessionHandoffs, setSessionHandoffs] = useState<HandoffLike[]>([]);
  const [persistedHandoffs, setPersistedHandoffs] = useState<HandoffLike[]>(() =>
    localStore.listHandoffs(),
  );
  const [handoffHistoryAvailable, setHandoffHistoryAvailable] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    readStoredProjectFilter(),
  );
  const [projectContext, setProjectContext] = useState<RemoteContext | null>(null);
  const [projectStates, setProjectStates] = useState<Array<Record<string, unknown>>>([]);

  const subjectId = ACTOR_IDS[actor];
  const location = useLocation();
  const routeProjectId = matchPath('/projects/:id', location.pathname)?.params.id ?? null;
  const readProjectId = resolveReadProjectId({
    routeProjectId,
    selectedProjectId,
  });
  const writeProjectId = resolveWriteProjectId({
    routeProjectId,
    selectedProjectId,
  });
  const selectedProject = useMemo(
    () => findProjectById(projects, selectedProjectId),
    [projects, selectedProjectId],
  );
  const routeProject = useMemo(() => findProjectById(projects, routeProjectId), [projects, routeProjectId]);
  const scopedProject = routeProjectId ? routeProject : selectedProject;
  const scopeLabel = routeProjectId
    ? routeProject?.name ?? routeProjectId
    : describeProjectScope(selectedProject);

  function buildLocalMe(nextActor: Actor): MeResponse {
    return {
      subjectId: ACTOR_IDS[nextActor],
      workspaceId: WORKSPACE_ID,
      isOwner: nextActor === 'owner',
      actor: {
        id: ACTOR_IDS[nextActor],
        externalKey: nextActor,
        displayName: ACTOR_LABELS[nextActor],
        kind: nextActor === 'owner' ? 'user' : 'agent',
      },
    };
  }

  function buildLocalConnectorCatalog(): ConnectorDefinitionRecord[] {
    return [
      {
        id: 'github',
        version: '1.0.0',
        displayName: 'GitHub',
        authType: 'oauth2',
        capabilities: ['repositories.read', 'pull_requests.read', 'issues.read'],
        storageModes: ['reference', 'indexed'],
      },
      {
        id: 'gmail',
        version: '1.0.0',
        displayName: 'Gmail (stub)',
        authType: 'oauth2',
        capabilities: ['messages.metadata', 'labels.read'],
        storageModes: ['reference', 'indexed'],
      },
      {
        id: 'google-drive',
        version: '1.0.0',
        displayName: 'Google Drive',
        authType: 'oauth2',
        capabilities: ['files.read', 'changes.list'],
        storageModes: ['reference', 'indexed'],
      },
      {
        id: 'google-calendar',
        version: '1.0.0',
        displayName: 'Google Calendar',
        authType: 'oauth2',
        capabilities: ['events.read'],
        storageModes: ['reference', 'indexed'],
      },
    ];
  }

  function isVisibleTaskStatus(status: unknown): boolean {
    return status !== 'deleted' && status !== 'retracted' && status !== 'superseded';
  }

  const onAuthBound = useCallback((authUserId: string, subjectIdBound: string) => {
    setBoundAuthUserId(authUserId);
    setBoundSubjectId(subjectIdBound);
  }, []);

  const onAuthUnbound = useCallback(() => {
    setBoundAuthUserId(null);
    setBoundSubjectId(null);
  }, []);

  useEffect(() => {
    persistProjectFilter(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (projects.length === 0) return;
    if (projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(null);
  }, [projects, selectedProjectId]);

  const onSelectProject = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
  }, []);

  async function refreshOutboxPending(mode: BackendMode = backend) {
    if (mode === 'local') {
      setOutboxPending([]);
      return;
    }
    try {
      const result = await apiGet<{ events?: OutboxPendingItem[] }>(
        `/v1/outbox/pending?workspace_id=${WORKSPACE_ID}&limit=20`,
        subjectId,
        actor,
      );
      setOutboxPending(result.events ?? []);
    } catch {
      setOutboxPending([]);
    }
  }

  async function refreshHandoffs(mode: BackendMode = backend) {
    if (mode === 'local') {
      setPersistedHandoffs(localStore.listHandoffs(readProjectId));
      setHandoffHistoryAvailable(true);
      return;
    }
    try {
      const result = await apiGet<{ handoffs?: HandoffLike[] }>(
        buildHandoffsPath({
          workspaceId: WORKSPACE_ID,
          projectId: readProjectId,
          limit: 50,
        }),
        subjectId,
        actor,
      );
      setPersistedHandoffs(result.handoffs ?? []);
      setHandoffHistoryAvailable(true);
    } catch {
      setPersistedHandoffs([]);
      setHandoffHistoryAvailable(false);
    }
  }

  async function refreshProjectContext(mode: BackendMode = backend) {
    if (mode === 'local') {
      const localProjectStates = readProjectId
        ? (() => {
            const state = localStore.getProjectState(readProjectId);
            return state ? [{ ...state } as Record<string, unknown>] : [];
          })()
        : [...localStore.projectStates.values()]
            .flatMap((versions) => {
              const state = versions[versions.length - 1];
              return state ? ([{ ...state }] as Array<Record<string, unknown>>) : [];
            });
      setProjectStates(localProjectStates);
      if (!readProjectId) {
        setProjectContext(null);
        return;
      }
      const localMemories = localStore.listCurrentMemories(WORKSPACE_ID, readProjectId);
      const localLatestHandoff = localStore.latestHandoff(readProjectId);
      setProjectContext({
        decisions: localMemories
          .filter((memory) => memory.memoryType === 'decision')
          .map((memory) => ({ ...memory })),
        tasks: localMemories
          .filter(
            (memory) =>
              memory.memoryType === 'task' && isVisibleTaskStatus(memory.status),
          )
          .map((memory) => ({ ...memory })),
        state: localProjectStates[0]
          ? ({ ...localProjectStates[0] } as Record<string, unknown>)
          : null,
        latestHandoff: localLatestHandoff ? { ...localLatestHandoff } : null,
      });
      return;
    }

    if (readProjectId) {
      try {
        const ctx = await apiGet<RemoteContext>(
          `/v1/projects/${readProjectId}/context`,
          subjectId,
          actor,
        );
        setProjectContext(ctx);
        setProjectStates(
          ctx.state && typeof ctx.state === 'object' ? [ctx.state as Record<string, unknown>] : [],
        );
      } catch {
        setProjectContext(null);
        setProjectStates([]);
      }
      return;
    }

    setProjectContext(null);
    if (projects.length === 0) {
      setProjectStates([]);
      return;
    }
    const states = await Promise.all(
      projects.map(async (project) => {
        try {
          const state = await apiGet<Record<string, unknown> | null>(
            `/v1/projects/${project.id}/state`,
            subjectId,
            actor,
          );
          if (!state || typeof state !== 'object') return null;
          return {
            ...state,
            projectId:
              typeof state.projectId === 'string'
                ? state.projectId
                : typeof state.project_id === 'string'
                  ? state.project_id
                  : project.id,
          };
        } catch {
          return null;
        }
      }),
    );
    setProjectStates(states.filter(Boolean) as Array<Record<string, unknown>>);
  }

  async function refreshRemote() {
    try {
      const health = await apiHealth();
      if (!health) {
        setBackend('local');
        setConnections([
          {
            connectorId: 'github',
            displayName: 'AISTROYKA repos',
            status: 'connected',
          },
        ]);
        setConnectorCatalog(buildLocalConnectorCatalog());
        setConnectionHealth({});
        setProjects([
          {
            id: PROJECT_ID,
            slug: 'aistroyka',
            name: 'AISTROYKA',
            status: 'active',
            url: 'https://github.com/aistroyka/core',
          },
        ]);
        setMe(buildLocalMe(actor));
        setOutboxPending([]);
        return;
      }

      const nextBackend = (health.backend as 'supabase' | 'memory-store') ?? 'memory-store';
      setBackend(nextBackend);
      setMe(buildLocalMe(actor));

      const conn = await apiGet<{ connections: ConnectionRecord[] }>(
        `/v1/connections?workspace_id=${WORKSPACE_ID}`,
        subjectId,
      );
      setConnections(conn.connections ?? []);
      const catalog = await apiGet<{ connectors: ConnectorDefinitionRecord[] }>(
        '/v1/connectors',
        subjectId,
      );
      setConnectorCatalog(catalog.connectors ?? []);
      const projectsResult = await apiGet<{ projects: ProjectRecord[] }>(
        `/v1/projects?workspace_id=${WORKSPACE_ID}`,
        subjectId,
        actor,
      );
      setProjects(projectsResult.projects ?? []);
      const healthEntries = await Promise.all(
        (conn.connections ?? [])
          .filter((connection): connection is ConnectionRecord & { id: string } => Boolean(connection.id))
          .map(async (connection) => {
            try {
              const healthResult = await apiGet<ConnectionHealthRecord>(
                `/v1/connections/${connection.id}/health`,
                subjectId,
                actor,
              );
              return [connection.id, healthResult] as const;
            } catch {
              return null;
            }
          }),
      );
      setConnectionHealth(
        Object.fromEntries(
          healthEntries.filter(
            (entry): entry is readonly [string, ConnectionHealthRecord] => entry !== null,
          ),
        ),
      );
      try {
        const currentMe = await apiGet<MeResponse>('/v1/me', subjectId, actor);
        setMe(currentMe);
      } catch {
        setMe(buildLocalMe(actor));
      }
      await refreshOutboxPending(nextBackend);
    } finally {
      setBackendResolved(true);
    }
  }

  async function refreshReviewQueue() {
    setReviewQueueLoading(true);
    try {
      if (backend === 'local') {
        setReviewQueue(
          localStore
            .listCurrentMemories(WORKSPACE_ID, readProjectId ?? undefined)
            .filter((memory) => memory.status === 'candidate' || memory.status === 'disputed')
            .map((memory) => ({
              id: memory.id,
              title: memory.title,
              content: memory.content.slice(0, 500),
              status: memory.status,
              projectId: memory.projectId ?? null,
            })),
        );
        return;
      }

      const [candidates, disputed] = await Promise.all([
        apiGet<{ memories: ReviewQueueItem[] }>(
          buildMemoriesPath({
            workspaceId: WORKSPACE_ID,
            projectId: readProjectId,
            status: 'candidate',
            limit: 50,
          }),
          subjectId,
          actor,
        ),
        apiGet<{ memories: ReviewQueueItem[] }>(
          buildMemoriesPath({
            workspaceId: WORKSPACE_ID,
            projectId: readProjectId,
            status: 'disputed',
            limit: 50,
          }),
          subjectId,
          actor,
        ),
      ]);
      const merged = [...(candidates.memories ?? []), ...(disputed.memories ?? [])];
      const seen = new Set<string>();

      setReviewQueue(
        merged.filter((memory) => {
          if (seen.has(memory.id)) return false;
          seen.add(memory.id);
          return true;
        }),
      );
    } finally {
      setReviewQueueLoading(false);
    }
  }

  async function refreshTaskMemories() {
    if (backend === 'local') {
      setScopedMemories(
        localStore
          .listCurrentMemories(WORKSPACE_ID, readProjectId ?? undefined)
          .map((memory) => ({ ...memory })),
      );
      return;
    }

    try {
      const result = await apiGet<{ memories?: Array<Record<string, unknown>> }>(
        buildMemoriesPath({
          workspaceId: WORKSPACE_ID,
          projectId: readProjectId,
          limit: 100,
        }),
        subjectId,
        actor,
      );
      setScopedMemories(result.memories ?? []);
    } catch {
      setScopedMemories([]);
    }
  }

  useEffect(() => {
    void refreshRemote().catch((err: Error) => setError(err.message));
  }, [actor, tick]);

  useEffect(() => {
    void refreshReviewQueue().catch((err: Error) => setError(err.message));
  }, [actor, backend, readProjectId, tick]);

  useEffect(() => {
    void refreshTaskMemories().catch((err: Error) => setError(err.message));
  }, [actor, backend, readProjectId, tick]);

  useEffect(() => {
    void refreshHandoffs().catch((err: Error) => setError(err.message));
  }, [actor, backend, readProjectId, tick]);

  useEffect(() => {
    void refreshProjectContext().catch((err: Error) => setError(err.message));
  }, [actor, backend, projects, readProjectId, tick]);

  useEffect(() => {
    setHits([]);
    setSearchContext(null);
  }, [readProjectId]);

  const taskMemories = useMemo(
    () =>
      scopedMemories.filter((memory) => {
        const memoryType = String(memory.memoryType ?? memory.type ?? '');
        return memoryType === 'task' && isVisibleTaskStatus(memory.status);
      }),
    [scopedMemories],
  );

  const timeline = useMemo(() => {
    if (projectContext) {
      const entries: TimelineEntry[] = [];
      for (const decision of projectContext.decisions ?? []) {
        entries.push({
          kind: 'decision',
          memoryId:
            typeof decision.id === 'string'
              ? decision.id
              : typeof decision.memory_id === 'string'
                ? decision.memory_id
                : undefined,
          at: String(decision.recorded_at ?? decision.recordedAt ?? new Date().toISOString()),
          title: String(decision.title ?? 'decision'),
          content: String(decision.content ?? ''),
          status: String(decision.status ?? 'verified'),
          projectId:
            typeof decision.projectId === 'string'
              ? decision.projectId
              : typeof decision.project_id === 'string'
                ? decision.project_id
                : readProjectId,
        });
      }
      if (projectContext.state && typeof projectContext.state === 'object') {
        const stateRecord = projectContext.state as Record<string, unknown>;
        const state = stateRecord.state as { next?: string[] } | undefined;
        entries.push({
          kind: 'state',
          at: String(stateRecord.created_at ?? stateRecord.createdAt ?? new Date().toISOString()),
          summary: String(stateRecord.summary ?? 'project state'),
          version: Number(stateRecord.version ?? 0),
          next: (state?.next ?? []).join(', ') || '—',
          projectId: readProjectId,
        });
      }
      const latestHandoff = persistedHandoffs[0] ?? projectContext.latestHandoff;
      if (latestHandoff) {
        const latestHandoffRecord = latestHandoff as Record<string, unknown>;
        const payload = latestHandoffRecord.payload as
          | {
              recommended_next?: string[];
              completed?: string[];
            }
          | undefined;
        entries.push({
          kind: 'handoff',
          at: String(
            latestHandoffRecord.created_at ??
              latestHandoffRecord.createdAt ??
              new Date().toISOString(),
          ),
          summary:
            payload?.recommended_next?.join(', ') ||
            payload?.completed?.join(', ') ||
            'handoff',
          projectId:
            typeof latestHandoffRecord.projectId === 'string'
              ? latestHandoffRecord.projectId
              : typeof latestHandoffRecord.project_id === 'string'
                ? latestHandoffRecord.project_id
                : readProjectId,
        });
      }
      return entries.sort((left, right) => right.at.localeCompare(left.at));
    }

    const entries: TimelineEntry[] = [];
    for (const memory of scopedMemories) {
      const memoryType = String(memory.memoryType ?? memory.type ?? '');
      if (memoryType !== 'decision') {
        continue;
      }
      entries.push({
        kind: 'decision',
        memoryId: typeof memory.id === 'string' ? memory.id : undefined,
        at: String(memory.recordedAt ?? memory.recorded_at ?? new Date().toISOString()),
        title: String(memory.title ?? 'decision'),
        content: String(memory.content ?? ''),
        status: String(memory.status ?? 'verified'),
        projectId:
          typeof memory.projectId === 'string'
            ? memory.projectId
            : typeof memory.project_id === 'string'
              ? memory.project_id
              : null,
      });
    }
    for (const stateRecord of projectStates) {
      const nestedState =
        typeof stateRecord.state === 'object' && stateRecord.state !== null
          ? (stateRecord.state as { next?: string[] })
          : undefined;
      entries.push({
        kind: 'state',
        at: String(stateRecord.created_at ?? stateRecord.createdAt ?? new Date().toISOString()),
        summary: String(stateRecord.summary ?? 'project state'),
        version: Number(stateRecord.version ?? 0),
        next: (nestedState?.next ?? []).join(', ') || '—',
        projectId:
          typeof stateRecord.projectId === 'string'
            ? stateRecord.projectId
            : typeof stateRecord.project_id === 'string'
              ? stateRecord.project_id
              : null,
      });
    }
    for (const handoff of persistedHandoffs) {
      const handoffRecord = handoff as Record<string, unknown>;
      const payload = handoffRecord.payload as
        | {
            recommended_next?: string[];
            completed?: string[];
          }
        | undefined;
      entries.push({
        kind: 'handoff',
        at: String(handoffRecord.created_at ?? handoffRecord.createdAt ?? new Date().toISOString()),
        summary:
          payload?.recommended_next?.join(', ') ||
          payload?.completed?.join(', ') ||
          'handoff',
        projectId:
          typeof handoffRecord.projectId === 'string'
            ? handoffRecord.projectId
            : typeof handoffRecord.project_id === 'string'
              ? handoffRecord.project_id
              : null,
      });
    }
    return entries.sort((left, right) => right.at.localeCompare(left.at));
  }, [persistedHandoffs, projectContext, projectStates, readProjectId, scopedMemories]);

  const stateSummary = useMemo<StateSummary | null>(() => {
    if (!readProjectId) {
      return null;
    }
    const stateRecord = projectContext?.state ?? projectStates[0] ?? null;
    if (!stateRecord || typeof stateRecord !== 'object') {
      return null;
    }
    const nestedState =
      typeof (stateRecord as { state?: unknown }).state === 'object' &&
      (stateRecord as { state?: unknown }).state !== null
        ? ((stateRecord as { state: Record<string, unknown> }).state as {
            stage?: string;
            completed?: string[];
            next?: string[];
            active_decisions?: string[];
          })
        : (stateRecord as {
            stage?: string;
            completed?: string[];
            next?: string[];
            active_decisions?: string[];
          });
    return {
      stage: nestedState.stage ?? '—',
      completed: (nestedState.completed ?? []).join(', ') || '—',
      next: (nestedState.next ?? []).join(', ') || '—',
      active: nestedState.active_decisions?.length ?? 0,
    };
  }, [projectContext, projectStates, readProjectId]);

  const taskSurface = useMemo(
    () =>
      deriveTaskSurface({
        taskMemories: [...taskMemories, ...(projectContext?.tasks ?? [])],
        projectState: readProjectId ? (projectContext?.state ?? projectStates[0] ?? null) : projectStates,
      }),
    [projectContext, projectStates, readProjectId, taskMemories],
  );

  const handoffSurface = useMemo(
    () =>
      deriveHandoffSurface({
        latestHandoff: persistedHandoffs[0] ?? projectContext?.latestHandoff ?? null,
        persistedHandoffs,
        sessionHandoffs,
        historyAvailable: handoffHistoryAvailable,
      }),
    [handoffHistoryAvailable, persistedHandoffs, projectContext, sessionHandoffs],
  );

  const connectionWarnings = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.status === 'reauth_required' || Boolean(connection.lastError),
      ),
    [connections],
  );

  function resolveExplicitWriteProjectId(): string {
    return requireExplicitProjectId(writeProjectId);
  }

  async function onStoreDecision() {
    setError(null);
    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      if (backend !== 'local') {
        await apiPost('/v1/memories', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          title,
          content,
          actor_subject_id: subjectId,
          idempotency_key: `web/${actor}/${Date.now()}`,
          importance: 0.7,
          confidence: 0.9,
          sensitivity: 'internal',
        });
      } else {
        localStore.createDecision({
          workspaceId: WORKSPACE_ID,
          projectId: targetProjectId,
          title,
          content,
          actorSubjectId: subjectId,
          idempotencyKey: `web/${actor}/${Date.now()}`,
        });
      }
      setLastCapture(`remembered decision "${title}"`);
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function createHandoff(
    payload: HandoffPayloadInput,
    options?: { targetActor?: AgentActor },
  ) {
    setError(null);
    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      const handoffPayload = {
        completed: payload.completed,
        artifacts: payload.artifacts,
        validation: payload.validation,
        open_items: payload.openItems,
        blockers: payload.blockers,
        recommended_next: payload.recommendedNext,
      };
      const targetActor = options?.targetActor ?? 'chatgpt';
      let handoff: HandoffLike;
      if (backend !== 'local') {
        handoff = await apiPost<Record<string, unknown>>('/v1/handoffs', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          from_subject_id: CURSOR,
          to_subject_id: ACTOR_IDS[targetActor],
          idempotency_key: `web-handoff-${Date.now()}`,
          payload: handoffPayload,
        });
      } else {
        handoff = localStore.createHandoff({
          workspaceId: WORKSPACE_ID,
          projectId: targetProjectId,
          fromSubjectId: CURSOR,
          toSubjectId: ACTOR_IDS[targetActor],
          payload: handoffPayload,
        });
      }
      setSessionHandoffs((current) => [handoff, ...current]);
      await refreshHandoffs(backend);
      setLastCapture(`создан хэнд-офф Cursor → ${ACTOR_LABELS[targetActor]}`);
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCreateHandoff() {
    await createHandoff(DEFAULT_HANDOFF_PAYLOAD);
  }

  async function onSearch() {
    setError(null);
    try {
      if (backend !== 'local') {
        const result = await apiPost<{
          hits: SearchHit[];
          ranking?: string;
          context?: SearchContext;
        }>(
          '/v1/search',
          subjectId,
          buildSearchRequest({
            query: search,
            projectId: readProjectId,
            packContext,
            maxContextChars: 3_000,
          }),
          actor,
        );
        setHits(result.hits ?? []);
        setSearchContext(packContext ? (result.context ?? null) : null);
      } else {
        const localHits = await searchMemoriesHybridLocal(
          localStore.listCurrentMemories(WORKSPACE_ID, readProjectId ?? undefined),
          search,
          { projectId: readProjectId ?? undefined },
        );
        setHits(
          localHits.map((hit) => ({
            memory: hit.memory,
            reason: hit.reason,
            score: hit.score,
          })),
        );
        setSearchContext(
          packContext ? packSearchContextLocal(localHits, { maxChars: 3_000 }) : null,
        );
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSetHitStatus(
    memoryId: string,
    status: MemoryStatusAction,
    options?: { quiet?: boolean },
  ): Promise<boolean> {
    if (!options?.quiet) {
      setError(null);
    }
    try {
      if (backend === 'local') {
        localStore.setMemoryStatus({
          memoryId,
          status,
          reason: `Web ${status} by ${actor}`,
          actorSubjectId: subjectId,
        });
      } else {
        await apiPost(
          `/v1/memories/${memoryId}/status`,
          subjectId,
          {
            status,
            reason: `Web ${status} by ${actor}`,
            actor_subject_id: subjectId,
          },
          actor,
        );
      }
      if (!options?.quiet) {
        setLastCapture(`memory ${memoryId.slice(0, 8)}… → ${status}`);
        await onSearch();
        try {
          await refreshReviewQueue();
        } catch (refreshError) {
          setError(
            `Статус сохранен, но не удалось обновить очередь на проверку: ${
              (refreshError as Error).message
            }`,
          );
        }
      }
      return true;
    } catch (err) {
      if (!options?.quiet) {
        setError((err as Error).message);
      }
      return false;
    }
  }

  async function onBulkReviewStatus(status: MemoryStatusAction) {
    setError(null);
    if (reviewQueue.length === 0) {
      setError('Review queue empty — candidates did not load yet');
      return;
    }

    let ok = 0;
    let failed = 0;

    for (const item of reviewQueue) {
      const done = await onSetHitStatus(item.id, status, { quiet: true });
      if (done) {
        ok += 1;
      } else {
        failed += 1;
      }
    }

    setLastCapture(`bulk ${status}: ok=${ok} failed=${failed}`);
    await onSearch();
    await refreshReviewQueue();
  }

  async function onCorrectMemory(
    memoryId: string,
    payload: CorrectMemoryPayload,
  ): Promise<boolean> {
    setError(null);
    try {
      if (backend === 'local') {
        localStore.correctMemory({
          memoryId,
          reason: payload.reason,
          actorSubjectId: subjectId,
          title: payload.title,
          content: payload.content,
          replacementMemoryId: payload.replacementMemoryId,
        });
      } else {
        await apiPatch(
          `/v1/memories/${memoryId}`,
          subjectId,
          {
            reason: payload.reason,
            title: payload.title,
            content: payload.content,
            replacement_memory_id: payload.replacementMemoryId,
            actor_subject_id: subjectId,
          },
          actor,
        );
      }
      setLastCapture(`исправлена память ${memoryId.slice(0, 8)}…`);
      setTick((current) => current + 1);
      await onSearch();
      try {
        await refreshReviewQueue();
      } catch (refreshError) {
        setError(
          `Исправление сохранено, но не удалось обновить очередь на проверку: ${
            (refreshError as Error).message
          }`,
        );
      }
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function onEmbedMemory(memoryId: string, options?: { title?: string; text?: string }) {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Re-embed requires API + Supabase backend');
        return;
      }
      const result = await apiPost<{
        dims?: number;
        engine?: string;
      }>(
        `/v1/memories/${memoryId}/embed`,
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          actor_subject_id: subjectId,
          title: options?.title,
          text: options?.text,
        },
        actor,
      );
      setLastCapture(
        `embed ${memoryId.slice(0, 8)}… dims=${result.dims ?? '?'} engine=${
          result.engine ?? '?'
        }`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCaptureText() {
    setError(null);
    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      if (backend !== 'local') {
        const result = await apiPost<{
          jobId?: string;
          process?: { memoryId?: string; chunkCount?: number };
          memoryId?: string;
        }>(
          '/v1/capture/text',
          subjectId,
          {
            workspace_id: WORKSPACE_ID,
            project_id: targetProjectId,
            title: captureTitle,
            text: captureText,
            actor_subject_id: subjectId,
            idempotency_key: `web-capture-${Date.now()}`,
            process_now: true,
          },
          actor,
        );
        if (result.jobId) {
          setJobLookupId(result.jobId);
        }
        setLastCapture(
          `job ${result.jobId ?? '?'} · memory ${
            result.process?.memoryId ?? result.memoryId ?? '?'
          } · chunks ${result.process?.chunkCount ?? 1}`,
        );
        setSearch(captureTitle.split(' ')[0] ?? 'Meeting');
      } else {
        const result = localStore.captureText({
          workspaceId: WORKSPACE_ID,
          projectId: targetProjectId,
          title: captureTitle,
          text: captureText,
          actorSubjectId: subjectId,
          idempotencyKey: `web-capture-${Date.now()}`,
        });
        setLastCapture(`local memory ${result.memoryId}`);
      }
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onPreviewExtraction() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Extraction preview requires API backend');
        return;
      }
      const result = await apiPost<{
        engine?: string;
        candidates?: Array<{
          title?: string;
          content?: string;
          memoryType?: string;
          confidence?: number;
        }>;
      }>(
        '/v1/extraction/preview',
        subjectId,
        {
          title: captureTitle,
          text: captureText,
        },
        actor,
      );
      const rows = (result.candidates ?? [])
        .filter((candidate) => candidate.title && candidate.content)
        .map((candidate) => ({
          title: String(candidate.title),
          content: String(candidate.content),
          memoryType: candidate.memoryType,
          confidence: candidate.confidence,
        }));
      setExtractionCandidates(rows);
      setExtractionSelected(new Set(rows.map((_, index) => index)));
      setExtractionPreview(
        `${result.engine ?? 'extract'}: ${rows.length} candidates — ${
          rows[0]?.title ?? 'none'
        }`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onApplyExtraction() {
    setError(null);
    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      if (backend === 'local') {
        setError('Extraction apply requires API backend');
        return;
      }
      const selected = extractionCandidates.filter((_, index) =>
        extractionSelected.has(index),
      );
      if (selected.length === 0) {
        setError('Select at least one extraction candidate');
        return;
      }
      const result = await apiPost<{
        applied?: number;
        failed?: number;
      }>(
        '/v1/extraction/apply',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          actor_subject_id: subjectId,
          idempotency_prefix: `web-extract-${Date.now()}`,
          candidates: selected,
        },
        actor,
      );
      setExtractionPreview(`applied ${result.applied ?? 0} · failed ${result.failed ?? 0}`);
      setTick((current) => current + 1);
      await refreshReviewQueue();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCaptureDocument() {
    setError(null);
    if (!docFile) {
      setError('Choose a .txt, .pdf, or .docx file');
      return;
    }

    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('failed to read file'));
        reader.onload = () => {
          const result = String(reader.result ?? '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(docFile);
      });

      if (backend === 'local') {
        setError('Document capture requires API backend (start dev:api)');
        return;
      }

      const result = await apiPost<{
        jobId?: string;
        process?: { memoryId?: string; chunkCount?: number };
        memoryId?: string;
        extractedChars?: number;
        filename?: string;
      }>(
        '/v1/capture/document',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          title: docTitle,
          filename: docFile.name,
          mime_type: docFile.type || undefined,
          content_base64: contentBase64,
          actor_subject_id: subjectId,
          idempotency_key: `web-doc-${Date.now()}`,
          process_now: true,
        },
        actor,
      );
      setLastCapture(
        `doc ${result.filename ?? docFile.name} · chars ${
          result.extractedChars ?? '?'
        } · memory ${result.process?.memoryId ?? result.memoryId ?? '?'}`,
      );
      setSearch(docTitle.split(' ')[0] ?? 'Uploaded');
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onCaptureLink() {
    setError(null);
    try {
      const targetProjectId = resolveExplicitWriteProjectId();
      if (backend === 'local') {
        setError('Link capture requires API backend');
        return;
      }
      const result = await apiPost<{
        process?: { memoryId?: string };
        memoryId?: string;
        finalUrl?: string;
        extractedChars?: number;
      }>(
        '/v1/capture/link',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          url: linkUrl,
          title: linkTitle,
          actor_subject_id: subjectId,
          idempotency_key: `web-link-${Date.now()}`,
          process_now: true,
        },
        actor,
      );
      setLastCapture(
        `link ${result.finalUrl ?? linkUrl} · chars ${
          result.extractedChars ?? '?'
        } · memory ${result.process?.memoryId ?? result.memoryId ?? '?'}`,
      );
      setSearch(linkTitle.split(' ')[0] ?? 'Linked');
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onLoadJob() {
    setError(null);
    try {
      if (!jobLookupId.trim()) {
        setError('Enter a job id');
        return;
      }
      if (backend === 'local') {
        setJobLookup({
          id: jobLookupId.trim(),
          status: 'succeeded',
          backend: 'local',
        });
        return;
      }
      const job = await apiGet<Record<string, unknown>>(
        `/v1/jobs/${encodeURIComponent(jobLookupId.trim())}`,
        subjectId,
        actor,
      );
      setJobLookup(job);
    } catch (err) {
      setJobLookup(null);
      setError((err as Error).message);
    }
  }

  async function onProcessJob() {
    setError(null);
    try {
      if (!jobLookupId.trim()) {
        setError('Enter a job id');
        return;
      }
      if (backend === 'local') {
        setError('Process job requires API backend');
        return;
      }
      const result = await apiPost<Record<string, unknown>>(
        `/v1/jobs/${encodeURIComponent(jobLookupId.trim())}/process`,
        subjectId,
        {},
        actor,
      );
      setJobLookup(result);
      setLastCapture(
        `processed job ${jobLookupId.trim()} · memory ${
          (result as { memoryId?: string }).memoryId ?? '?'
        }`,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onBumpState() {
    setError(null);
    const targetProjectId = resolveExplicitWriteProjectId();
    const stateRecord =
      projectContext?.state && typeof projectContext.state === 'object'
        ? (projectContext.state as Record<string, unknown>)
        : null;
    const expectedVersion = Number(stateRecord?.version ?? 1);
    const current =
      ((stateRecord?.state as {
        stage?: string;
        completed?: string[];
        in_progress?: string[];
        blocked?: string[];
        next?: string[];
        risks?: string[];
        active_decisions?: string[];
      }) ??
        {});
    try {
      if (backend !== 'local') {
        await apiPatch(`/v1/projects/${targetProjectId}/state`, subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: targetProjectId,
          expected_version: expectedVersion,
          actor_subject_id: subjectId,
          idempotency_key: `web-bump-${Date.now()}`,
          summary: `State bumped by ${actor}`,
          state: {
            stage: current.stage ?? 'slice-01-ready',
            completed: current.completed ?? [],
            in_progress: current.in_progress ?? ['control-center'],
            blocked: current.blocked ?? [],
            next: ['connections health review', ...(current.next ?? [])].slice(0, 5),
            risks: current.risks ?? [],
            active_decisions: current.active_decisions ?? [],
          },
        });
      } else {
        localStore.upsertProjectState({
          workspaceId: WORKSPACE_ID,
          projectId: targetProjectId,
          expectedVersion: localStore.getProjectState(targetProjectId)?.version ?? 0,
          actorSubjectId: subjectId,
          summary: `State bumped by ${actor}`,
          state: {
            stage: 'slice-01-ready',
            completed: ['product-design-audit'],
            in_progress: ['control-center'],
            blocked: [],
            next: ['connections health review'],
            risks: [],
            active_decisions: [],
          },
        });
      }
      setLastCapture('project state bumped');
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onRunConsolidation() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Consolidation requires API backend');
        return;
      }
      const report = await apiPost<{
        planned?: number;
        applied?: unknown[];
        job?: { jobId?: string } | null;
      }>(
        '/v1/consolidation/run',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          actor_subject_id: subjectId,
          apply: true,
          enqueue: true,
        },
        actor,
      );
      setLastCapture(
        `consolidation planned=${report.planned ?? 0} applied=${report.applied?.length ?? 0}${
          report.job?.jobId ? ` job=${report.job.jobId}` : ''
        }`,
      );
      await refreshReviewQueue();
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onEmbedMissing() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Embed-missing requires API + Supabase backend');
        return;
      }
      const report = await apiPost<{
        scanned?: number;
        missing?: number;
        embedded?: number;
        failed?: unknown[];
      }>(
        '/v1/memories/embed-missing',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          actor_subject_id: subjectId,
          limit: 25,
        },
        actor,
      );
      setLastCapture(
        `embed-missing scanned=${report.scanned ?? 0} missing=${
          report.missing ?? 0
        } embedded=${report.embedded ?? 0} failed=${report.failed?.length ?? 0}`,
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onConnectGmailStub() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Connect stub requires API backend');
        return;
      }
      await apiPost(
        '/v1/connections',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          connector_id: 'gmail',
          display_name: 'Pilot inbox',
          scopes: ['messages.metadata'],
          status: 'connected',
          actor_subject_id: subjectId,
        },
        actor,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onStartOAuth(options?: {
    connectorId?: string;
    displayName?: string;
    scopes?: string[];
  }) {
    setError(null);
    try {
      if (backend === 'local') {
        setError('OAuth broker requires API backend');
        return;
      }
      const connectorId = options?.connectorId ?? 'github';
      const displayName = options?.displayName ?? 'OAuth pilot repos';
      const scopes = options?.scopes ?? ['repositories.read'];
      const start = await apiPost<{
        state?: string;
        authorizeUrl?: string;
      }>(
        '/v1/oauth/start',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          connector_id: connectorId,
          display_name: displayName,
          scopes,
          redirect_uri: `${window.location.origin}/oauth/callback`,
          actor_subject_id: subjectId,
        },
        actor,
      );
      const authorizeUrl = start.authorizeUrl ?? '';
      if (authorizeUrl.startsWith('http')) {
        storePendingOAuthSession({ subjectId, actorKey: actor });
        window.location.assign(authorizeUrl);
        return;
      }
      const done = await apiPost<{
        exchangeMode?: string;
        tokensInVault?: boolean;
      }>(
        '/v1/oauth/callback',
        subjectId,
        {
          state: start.state,
          code: 'stub-code',
          actor_subject_id: subjectId,
        },
        actor,
      );
      setLastCapture(
        `oauth ${connectorId}:${authorizeUrl || 'stub'} → mode=${done.exchangeMode ?? 'stub'} vault=${
          done.tokensInVault ? 'yes' : 'no'
        }`,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSyncConnections(connectionId?: string) {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Connector sync requires API backend');
        return;
      }
      const plan = await apiPost<{
        count?: number;
        captured?: number;
        completed?: Array<{ status?: string }>;
      }>(
        '/v1/connections/sync',
        subjectId,
        {
          connection_id: connectionId,
          workspace_id: WORKSPACE_ID,
          actor_subject_id: subjectId,
        },
        actor,
      );
      const failed = (plan.completed ?? []).filter(
        (row) => row.status && row.status !== 'succeeded',
      ).length;
      setLastCapture(
        `connector sync enqueued=${plan.count ?? 0} captured=${plan.captured ?? 0} failed=${failed}`,
      );
      await refreshOutboxPending();
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDiscoverConnection(connectionId: string) {
    setError(null);
    try {
      if (backend === 'local') {
        setLastCapture('В локальном preview список репозиториев синтетический и уже показан.');
        setTick((current) => current + 1);
        return;
      }
      const result = await apiPost<{
        collections?: Array<{ id: string }>;
      }>(
        `/v1/connections/${connectionId}/discover`,
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          actor_subject_id: subjectId,
        },
        actor,
      );
      setLastCapture(`discover: найдено репозиториев ${result.collections?.length ?? 0}`);
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onUpdateConnectionCollections(
    connection: ConnectionRecord,
    excludedIds: string[],
  ) {
    if (!connection.id) return;
    setError(null);
    try {
      if (backend === 'local') {
        setLastCapture('В локальном preview выбор коллекций не сохраняется.');
        return;
      }
      const metadata = {
        ...(connection.metadata ?? {}),
        collections: {
          ...(connection.metadata?.collections ?? {}),
          selection_mode: 'all' as const,
          excluded_ids: excludedIds,
          items: connection.metadata?.collections?.items ?? [],
          project_bindings: connection.metadata?.collections?.project_bindings ?? {},
        },
      };
      await apiPatch(
        `/v1/connections/${connection.id}`,
        subjectId,
        {
          actor_subject_id: subjectId,
          metadata,
        },
        actor,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onExportMemories() {
    setError(null);
    try {
      if (actor !== 'owner') {
        setError('Export requires owner actor');
        return;
      }
      const dump = await apiGet<{ format?: string; count?: number }>(
        `/v1/export/memories?workspace_id=${WORKSPACE_ID}&limit=200`,
        subjectId,
        actor,
      );
      const blob = new Blob([JSON.stringify(dump, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `memory-os-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setLastCapture(`exported memories format=${dump.format ?? '?'} count=${dump.count ?? 0}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDeadLetterJobs() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('Dead-letter requires API backend');
        return;
      }
      const result = await apiPost<{ deadLettered?: number }>(
        '/v1/jobs/dead-letter-stale',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          older_than_minutes: 60,
        },
        actor,
      );
      setLastCapture(`dead-lettered stale jobs: ${result.deadLettered ?? 0}`);
      await refreshOutboxPending();
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onAckOutbox(id: string) {
    setError(null);
    try {
      await apiPost(`/v1/outbox/${id}/publish`, subjectId, { error: 'acked from web' }, actor);
      await refreshOutboxPending();
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onUpdateConnectionStatus(
    id: string,
    status: 'reauth_required' | 'revoked' | 'connected',
    lastErrorValue: string | null,
  ) {
    setError(null);
    try {
      await apiPost(
        `/v1/connections/${id}/status`,
        subjectId,
        {
          status,
          last_error: lastErrorValue,
          actor_subject_id: subjectId,
        },
        actor,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onRevokeConnection(id: string) {
    setError(null);
    try {
      await apiPost(
        `/v1/connections/${id}/revoke`,
        subjectId,
        {
          actor_subject_id: subjectId,
        },
        actor,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onRefresh() {
    setTick((current) => current + 1);
  }

  function onToggleExtractionSelected(index: number) {
    setExtractionSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  const authPanel = <AuthPanel onBound={onAuthBound} onUnbound={onAuthUnbound} />;
  const globalScopePanel = (
    <ProjectScopePanel
      projects={projects}
      selectedProjectId={selectedProjectId}
      onSelectProject={onSelectProject}
    />
  );
  const projectPageName = routeProject?.name ?? routeProjectId ?? 'Проект';

  return (
    <AppShell
      backend={backend}
      boundSubjectId={boundSubjectId}
      authPanel={authPanel}
      error={error}
      notice={lastCapture}
    >
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              scopeLabel={scopeLabel}
              scopePanel={globalScopePanel}
              stateSummary={stateSummary}
              timeline={timeline}
              reviewQueueCount={reviewQueue.length}
              reviewQueueLoading={reviewQueueLoading}
              connectionWarnings={connectionWarnings}
              taskPreview={taskSurface.outstanding[0] ?? null}
              lastHandoff={handoffSurface.latest}
            />
          }
        />
        <Route
          path="/connections"
          element={
            <ConnectionsPage
              backend={backend}
              connectors={connectorCatalog}
              connections={connections}
              connectionHealth={connectionHealth}
              onRefresh={onRefresh}
              onConnectGmailStub={onConnectGmailStub}
              onStartOAuth={onStartOAuth}
              onDiscoverConnection={onDiscoverConnection}
              onSyncConnections={onSyncConnections}
              onUpdateConnectionCollections={onUpdateConnectionCollections}
              onRevokeConnection={onRevokeConnection}
            />
          }
        />
        <Route
          path="/agents"
          element={
            <AgentScopesPage
              actor={actor}
              backend={backend}
              backendResolved={backendResolved}
              me={me}
              subjectId={subjectId}
            />
          }
        />
        <Route
          path="/audit"
          element={
            <AuditPage
              actor={actor}
              backend={backend}
              backendResolved={backendResolved}
              subjectId={subjectId}
            />
          }
        />
        <Route
          path="/privacy"
          element={
            <PrivacyPage
              actor={actor}
              backend={backend}
              backendResolved={backendResolved}
              onExportMemories={onExportMemories}
              subjectId={subjectId}
            />
          }
        />
        <Route
          path="/tasks"
          element={
            <TasksPage
              scopeLabel={scopeLabel}
              scopePanel={globalScopePanel}
              taskSurface={taskSurface}
            />
          }
        />
        <Route
          path="/handoffs"
          element={
            <HandoffsPage
              scopeLabel={scopeLabel}
              scopePanel={globalScopePanel}
              handoffSurface={handoffSurface}
              writeProjectName={scopedProject?.name ?? null}
              onCreateHandoff={createHandoff}
            />
          }
        />
        <Route
          path="/conflicts"
          element={
            <ConflictsPage
              actor={actor}
              backend={backend}
              scopeLabel={scopeLabel}
              scopePanel={globalScopePanel}
              reviewQueue={reviewQueue}
              reviewQueueLoading={reviewQueueLoading}
              onSetReviewStatus={onSetHitStatus}
              onRunConsolidation={onRunConsolidation}
            />
          }
        />
        <Route
          path="/search"
          element={
            <SearchPage
              scopeLabel={scopeLabel}
              scopePanel={globalScopePanel}
              search={search}
              packContext={packContext}
              searchContext={searchContext}
              hits={hits}
              onSearchTermChange={setSearch}
              onPackContextChange={setPackContext}
              onSearch={onSearch}
            />
          }
        />
        <Route
          path="/projects"
          element={
            <ProjectsPage
              projects={projects}
              selectedProjectId={selectedProjectId}
              scopePanel={globalScopePanel}
              onSelectProject={onSelectProject}
            />
          }
        />
        <Route
          path="/memories/:id"
          element={
            <MemoryInspectorPage
              actor={actor}
              backend={backend}
              backendResolved={backendResolved}
              subjectId={subjectId}
              localStore={localStore}
              onSetMemoryStatus={onSetHitStatus}
              onCorrectMemory={onCorrectMemory}
            />
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ProjectPage
              actor={actor}
              projectName={projectPageName}
              stateSummary={stateSummary}
              timeline={timeline}
              title={title}
              content={content}
              reviewQueue={reviewQueue}
              reviewQueueLoading={reviewQueueLoading}
              onTitleChange={setTitle}
              onContentChange={setContent}
              onStoreDecision={onStoreDecision}
              onCreateHandoff={onCreateHandoff}
              onSetReviewStatus={onSetHitStatus}
            />
          }
        />
        <Route
          path="/ops"
          element={
            <OpsPage
              actor={actor}
              backend={backend}
              scopePanel={globalScopePanel}
              writeProjectName={scopedProject?.name ?? null}
              search={search}
              packContext={packContext}
              searchContext={searchContext}
              hits={hits}
              captureTitle={captureTitle}
              captureText={captureText}
              lastCapture={lastCapture}
              docTitle={docTitle}
              docFileName={docFile?.name ?? null}
              linkUrl={linkUrl}
              linkTitle={linkTitle}
              reviewQueue={reviewQueue}
              outboxPending={outboxPending}
              jobLookupId={jobLookupId}
              jobLookup={jobLookup}
              extractionPreview={extractionPreview}
              extractionCandidates={extractionCandidates}
              extractionSelected={extractionSelected}
              connections={connections}
              onActorChange={setActor}
              onRefresh={onRefresh}
              onBumpState={onBumpState}
              onSearchTermChange={setSearch}
              onPackContextChange={setPackContext}
              onSearch={onSearch}
              onSetHitStatus={onSetHitStatus}
              onEmbedMemory={onEmbedMemory}
              onCaptureTitleChange={setCaptureTitle}
              onCaptureTextChange={setCaptureText}
              onCaptureText={onCaptureText}
              onPreviewExtraction={onPreviewExtraction}
              onApplyExtraction={onApplyExtraction}
              onToggleExtractionSelected={onToggleExtractionSelected}
              onDocTitleChange={setDocTitle}
              onDocFileChange={setDocFile}
              onCaptureDocument={onCaptureDocument}
              onLinkUrlChange={setLinkUrl}
              onLinkTitleChange={setLinkTitle}
              onCaptureLink={onCaptureLink}
              onRefreshReviewQueue={refreshReviewQueue}
              onBulkReviewStatus={onBulkReviewStatus}
              onRunConsolidation={onRunConsolidation}
              onEmbedMissing={onEmbedMissing}
              onJobLookupIdChange={setJobLookupId}
              onLoadJob={onLoadJob}
              onProcessJob={onProcessJob}
              onConnectGmailStub={onConnectGmailStub}
              onStartOAuth={onStartOAuth}
              onSyncConnections={onSyncConnections}
              onLoadOutbox={refreshOutboxPending}
              onExportMemories={onExportMemories}
              onDeadLetterJobs={onDeadLetterJobs}
              onAckOutbox={onAckOutbox}
              onUpdateConnectionStatus={onUpdateConnectionStatus}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

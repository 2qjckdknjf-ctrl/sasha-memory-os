import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { createSeededStore } from '@memory-os/domain';
import { apiGet, apiHealth, apiPatch, apiPost, setBoundAuthUserId } from './api';
import { AppShell } from './AppShell';
import { AuthPanel } from './AuthPanel';
import { ConflictsPage } from './ConflictsPage';
import { HomePage } from './HomePage';
import { MemoryInspectorPage } from './MemoryInspectorPage';
import { OpsPage } from './OpsPage';
import { ProjectPage } from './ProjectPage';
import { SearchPage } from './SearchPage';
import {
  ACTOR_IDS,
  CHATGPT,
  CURSOR,
  PROJECT_ID,
  WORKSPACE_ID,
  type Actor,
  type BackendMode,
  type ConnectionRecord,
  type ExtractionCandidate,
  type MemoryStatusAction,
  type OutboxPendingItem,
  type RemoteContext,
  type ReviewQueueItem,
  type SearchContext,
  type SearchHit,
  type StateSummary,
  type TimelineEntry,
} from './controlCenter';

export function App() {
  const [localStore] = useState(() => createSeededStore());
  const [actor, setActor] = useState<Actor>('owner');
  const [backend, setBackend] = useState<BackendMode>('local');
  const [backendResolved, setBackendResolved] = useState(false);
  const [remote, setRemote] = useState<RemoteContext | null>(null);
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
  const [jobLookupId, setJobLookupId] = useState('');
  const [jobLookup, setJobLookup] = useState<Record<string, unknown> | null>(null);
  const [extractionPreview, setExtractionPreview] = useState<string | null>(null);
  const [extractionCandidates, setExtractionCandidates] = useState<ExtractionCandidate[]>(
    [],
  );
  const [extractionSelected, setExtractionSelected] = useState<Set<number>>(
    () => new Set(),
  );

  const subjectId = ACTOR_IDS[actor];

  const onAuthBound = useCallback((authUserId: string, subjectIdBound: string) => {
    setBoundAuthUserId(authUserId);
    setBoundSubjectId(subjectIdBound);
  }, []);

  const onAuthUnbound = useCallback(() => {
    setBoundAuthUserId(null);
    setBoundSubjectId(null);
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

  async function refreshRemote() {
    try {
      const health = await apiHealth();
      if (!health) {
        setBackend('local');
        setRemote(null);
        setConnections([
          {
            connectorId: 'github',
            displayName: 'AISTROYKA repos',
            status: 'connected',
          },
        ]);
        setOutboxPending([]);
        return;
      }

      const nextBackend = (health.backend as 'supabase' | 'memory-store') ?? 'memory-store';
      setBackend(nextBackend);

      const ctx = await apiGet<RemoteContext>(`/v1/projects/${PROJECT_ID}/context`, subjectId);
      setRemote(ctx);

      const conn = await apiGet<{ connections: ConnectionRecord[] }>(
        `/v1/connections?workspace_id=${WORKSPACE_ID}`,
        subjectId,
      );
      setConnections(conn.connections ?? []);
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
          [...localStore.memories.values()]
            .filter((memory) => memory.status === 'candidate' || memory.status === 'disputed')
            .map((memory) => ({
              id: memory.id,
              title: memory.title,
              content: memory.content.slice(0, 500),
              status: memory.status,
            })),
        );
        return;
      }

      const [candidates, disputed] = await Promise.all([
        apiGet<{ memories: ReviewQueueItem[] }>(
          `/v1/memories?workspace_id=${WORKSPACE_ID}&project_id=${PROJECT_ID}&status=candidate&limit=50`,
          subjectId,
          actor,
        ),
        apiGet<{ memories: ReviewQueueItem[] }>(
          `/v1/memories?workspace_id=${WORKSPACE_ID}&project_id=${PROJECT_ID}&status=disputed&limit=50`,
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

  useEffect(() => {
    void refreshRemote().catch((err: Error) => setError(err.message));
  }, [actor, tick]);

  useEffect(() => {
    void refreshReviewQueue().catch((err: Error) => setError(err.message));
  }, [actor, backend, tick]);

  const timeline = useMemo(() => {
    if (remote) {
      const entries: TimelineEntry[] = [];
      for (const decision of remote.decisions ?? []) {
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
        });
      }
      if (remote.state) {
        const state = remote.state.state as { next?: string[] } | undefined;
        entries.push({
          kind: 'state',
          at: String(remote.state.created_at ?? new Date().toISOString()),
          summary: String(remote.state.summary ?? 'project state'),
          version: Number(remote.state.version ?? 0),
          next: (state?.next ?? []).join(', ') || '—',
        });
      }
      if (remote.latestHandoff) {
        const payload = remote.latestHandoff.payload as {
          recommended_next?: string[];
          completed?: string[];
        };
        entries.push({
          kind: 'handoff',
          at: String(remote.latestHandoff.created_at ?? new Date().toISOString()),
          summary:
            payload?.recommended_next?.join(', ') ||
            payload?.completed?.join(', ') ||
            'handoff',
        });
      }
      return entries.sort((left, right) => right.at.localeCompare(left.at));
    }

    const entries: TimelineEntry[] = [];
    for (const memory of localStore.listCurrentMemories(WORKSPACE_ID, PROJECT_ID)) {
      if (memory.memoryType === 'decision') {
        entries.push({
          kind: 'decision',
          memoryId: memory.id,
          at: memory.recordedAt,
          title: memory.title,
          content: memory.content,
          status: memory.status,
        });
      }
    }
    const state = localStore.getProjectState(PROJECT_ID);
    if (state) {
      entries.push({
        kind: 'state',
        at: state.createdAt,
        summary: state.summary ?? state.state.stage,
        version: state.version,
        next: state.state.next.join(', ') || '—',
      });
    }
    for (const handoff of localStore.handoffs.get(PROJECT_ID) ?? []) {
      entries.push({
        kind: 'handoff',
        at: handoff.createdAt,
        summary:
          handoff.payload.recommended_next.join(', ') ||
          handoff.payload.completed.join(', '),
      });
    }
    return entries.sort((left, right) => right.at.localeCompare(left.at));
  }, [localStore, remote, tick]);

  const stateSummary = useMemo<StateSummary | null>(() => {
    if (remote?.state) {
      const state = remote.state.state as {
        stage?: string;
        completed?: string[];
        next?: string[];
        active_decisions?: string[];
      };
      return {
        stage: state.stage ?? '—',
        completed: (state.completed ?? []).join(', ') || '—',
        next: (state.next ?? []).join(', ') || '—',
        active: state.active_decisions?.length ?? 0,
      };
    }

    const localState = localStore.getProjectState(PROJECT_ID);
    if (!localState) {
      return null;
    }

    return {
      stage: localState.state.stage,
      completed: localState.state.completed.join(', ') || '—',
      next: localState.state.next.join(', ') || '—',
      active: localState.state.active_decisions.length,
    };
  }, [localStore, remote, tick]);

  const connectionWarnings = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.status === 'reauth_required' || Boolean(connection.lastError),
      ),
    [connections],
  );

  async function onStoreDecision() {
    setError(null);
    try {
      if (backend !== 'local') {
        await apiPost('/v1/memories', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
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
          projectId: PROJECT_ID,
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

  async function onCreateHandoff() {
    setError(null);
    try {
      if (backend !== 'local') {
        await apiPost('/v1/handoffs', subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          from_subject_id: CURSOR,
          to_subject_id: CHATGPT,
          idempotency_key: `web-handoff-${Date.now()}`,
          payload: {
            completed: ['Loaded project context from Memory OS'],
            artifacts: [],
            validation: ['typecheck', 'unit tests'],
            open_items: ['Keep expanding control center'],
            blockers: [],
            recommended_next: ['Wire search UX'],
          },
        });
      } else {
        localStore.createHandoff({
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          fromSubjectId: CURSOR,
          toSubjectId: CHATGPT,
          payload: {
            completed: ['Loaded project context from Memory OS'],
            artifacts: [],
            validation: ['typecheck', 'unit tests'],
            open_items: [],
            blockers: [],
            recommended_next: ['Wire search UX'],
          },
        });
      }
      setLastCapture('created Cursor → ChatGPT handoff');
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
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
          {
            query: search,
            project_id: PROJECT_ID,
            pack_context: packContext,
            max_context_chars: 3_000,
          },
          actor,
        );
        setHits(result.hits ?? []);
        setSearchContext(packContext ? (result.context ?? null) : null);
      } else {
        const { packSearchContext, searchMemoriesHybrid } = await import(
          '@memory-os/retrieval'
        );
        const localHits = await searchMemoriesHybrid(
          [...localStore.memories.values()],
          search,
          { projectId: PROJECT_ID },
        );
        setHits(
          localHits.map((hit) => ({
            memory: hit.memory,
            reason: hit.reason,
            score: hit.score,
          })),
        );
        setSearchContext(
          packContext ? packSearchContext(localHits, { maxChars: 3_000 }) : null,
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
            project_id: PROJECT_ID,
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
          projectId: PROJECT_ID,
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
          project_id: PROJECT_ID,
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
          project_id: PROJECT_ID,
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
          project_id: PROJECT_ID,
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
    const expectedVersion = Number(remote?.state?.version ?? 1);
    const current =
      (remote?.state?.state as {
        stage?: string;
        completed?: string[];
        in_progress?: string[];
        blocked?: string[];
        next?: string[];
        risks?: string[];
        active_decisions?: string[];
      }) ?? {};
    try {
      if (backend !== 'local') {
        await apiPatch(`/v1/projects/${PROJECT_ID}/state`, subjectId, {
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
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
          projectId: PROJECT_ID,
          expectedVersion: localStore.getProjectState(PROJECT_ID)?.version ?? 0,
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

  async function onStartOAuth() {
    setError(null);
    try {
      if (backend === 'local') {
        setError('OAuth broker requires API backend');
        return;
      }
      const start = await apiPost<{
        state?: string;
        authorizeUrl?: string;
      }>(
        '/v1/oauth/start',
        subjectId,
        {
          workspace_id: WORKSPACE_ID,
          connector_id: 'github',
          display_name: 'OAuth pilot repos',
          scopes: ['repositories.read'],
          redirect_uri: `${window.location.origin}/oauth/callback`,
          actor_subject_id: subjectId,
        },
        actor,
      );
      const authorizeUrl = start.authorizeUrl ?? '';
      if (authorizeUrl.startsWith('http')) {
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
        `oauth ${authorizeUrl || 'stub'} → mode=${done.exchangeMode ?? 'stub'} vault=${
          done.tokensInVault ? 'yes' : 'no'
        }`,
      );
      setTick((current) => current + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onSyncConnections() {
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
              stateSummary={stateSummary}
              timeline={timeline}
              reviewQueueCount={reviewQueue.length}
              reviewQueueLoading={reviewQueueLoading}
              connectionWarnings={connectionWarnings}
            />
          }
        />
        <Route
          path="/conflicts"
          element={
            <ConflictsPage
              actor={actor}
              backend={backend}
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
        <Route path="/projects" element={<Navigate to={`/projects/${PROJECT_ID}`} replace />} />
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
            />
          }
        />
        <Route
          path="/projects/:id"
          element={
            <ProjectPage
              actor={actor}
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

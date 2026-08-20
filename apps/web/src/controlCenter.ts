export const PROJECT_ID = '44444444-4444-4444-8444-444444444401';
export const PROJECT_NAME = 'AISTROYKA';
export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
export const CURSOR = '33333333-3333-4333-8333-333333333303';
export const CHATGPT = '33333333-3333-4333-8333-333333333302';
export const ROMA = '33333333-3333-4333-8333-333333333304';

export type Actor = 'owner' | 'chatgpt' | 'cursor' | 'roma';
export type AgentActor = Exclude<Actor, 'owner'>;

export const ACTOR_IDS: Record<Actor, string> = {
  owner: '33333333-3333-4333-8333-333333333301',
  chatgpt: CHATGPT,
  cursor: CURSOR,
  roma: ROMA,
};

export const ACTOR_LABELS: Record<Actor, string> = {
  owner: 'Owner',
  chatgpt: 'ChatGPT',
  cursor: 'Cursor',
  roma: 'ROMA',
};

export type TimelineEntry =
  | {
      kind: 'decision';
      at: string;
      title: string;
      content: string;
      status: string;
      memoryId?: string;
      projectId?: string | null;
    }
  | { kind: 'state'; at: string; summary: string; version: number; next: string; projectId?: string | null }
  | { kind: 'handoff'; at: string; summary: string; projectId?: string | null };

export type RemoteContext = {
  decisions?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  state?: Record<string, unknown> | null;
  latestHandoff?: Record<string, unknown> | null;
};

export type SearchContext = {
  text?: string;
  packedCount?: number;
  truncated?: boolean;
  citations?: Array<{ index: number; memoryId: string | null; title: string }>;
};

export type SearchHit = {
  memory?: {
    id?: string;
    title?: string;
    content?: string;
    status?: string;
    memoryType?: string;
    type?: string;
    projectId?: string | null;
  };
  reason?: string;
  score?: number;
};

export type MemoryStatusAction = 'verified' | 'disputed' | 'retracted';

export type CorrectMemoryPayload = {
  reason: string;
  title?: string;
  content?: string;
  replacementMemoryId?: string;
};

export type AttentionItemSource = 'review' | 'conflicts';

export type MemoryDetail = {
  id: string;
  title: string;
  content: string;
  status: string;
  memoryType?: string;
  type?: string;
  sensitivity?: string;
  projectId?: string | null;
  workspaceId?: string | null;
  recordedAt?: string;
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  sourceEventId?: string | null;
  createdBySubject?: string | null;
  supersededBy?: string | null;
  importance?: number;
  confidence?: number;
  schemaVersion?: string;
  metadata?: Record<string, unknown>;
  source?: Record<string, unknown> | null;
  evidence?: Array<Record<string, unknown>> | null;
  provenance?: Record<string, unknown> | null;
  embeddingEngine?: string | null;
  embeddingDims?: number | null;
};

export type TransferredObjectRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  status: string;
  kind: 'text' | 'file' | 'photo' | 'video' | 'url';
  source: 'companion_app' | 'share_extension' | 'document_picker' | 'photo_library';
  sensitivity: string;
  memory_type?: string | null;
  source_event_id?: string | null;
  device_id?: string | null;
  connection_id?: string | null;
  item_id?: string | null;
  filename?: string | null;
  canonical_reference?: string | null;
  observed_at?: string | null;
  recorded_at: string;
  delete_local_after_ack: boolean;
  identifiers: {
    local_identifier?: string;
    cloud_identifier?: string;
    provider_item_identifier?: string;
  };
};

export type ConnectionRecord = {
  id?: string;
  connectorId?: string;
  displayName?: string;
  status?: string;
  scopes?: string[];
  lastSyncAt?: string | null;
  lastError?: string | null;
  vaultRef?: string | null;
  metadata?: ConnectionMetadataRecord;
};

export type ConnectionCollectionRecord = {
  id: string;
  external_id?: string;
  kind?: string;
  name: string;
  title?: string;
  url?: string;
  description?: string | null;
  default_branch?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConnectionCollectionsStateRecord = {
  selection_mode?: 'all';
  excluded_ids?: string[];
  items?: ConnectionCollectionRecord[];
  discovered_at?: string;
  synced_at?: string;
  project_bindings?: Record<string, string>;
};

export type ConnectionMetadataRecord = Record<string, unknown> & {
  collections?: ConnectionCollectionsStateRecord;
  default_project_id?: string;
};

export type ConnectorDefinitionRecord = {
  id: string;
  version?: string;
  displayName?: string;
  authType?: string;
  capabilities?: string[];
  supports?: Record<string, unknown>;
  storageModes?: string[];
};

export type ConnectionHealthRecord = {
  connectionId: string;
  connectorId: string;
  status: 'healthy' | 'degraded' | 'reauth_required' | 'revoked' | 'disabled';
  note: string;
  vaultRef?: string;
  checkedAt?: string;
  checks?: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
  }>;
};

export type ActorMeta = {
  id: string;
  externalKey?: string;
  displayName?: string;
  kind?: string;
};

export type MeResponse = {
  subjectId: string;
  workspaceId: string;
  isOwner: boolean;
  actor: ActorMeta;
};

export type AuditEventRecord = {
  id: string;
  workspaceId: string;
  actorSubjectId?: string | null;
  actor?: ActorMeta | null;
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  recordedAt: string;
};

export type PrivacyRequestRecord = {
  id: string;
  workspaceId: string;
  projectId?: string | null;
  actorSubjectId?: string | null;
  actor?: ActorMeta | null;
  requestType: 'deletion' | 'correction' | 'retraction';
  status: 'submitted';
  targetMemoryId?: string | null;
  reason: string;
  correctionText?: string | null;
  createdAt: string;
};

export type AgentRight = {
  effect: string;
  resourceType: string;
  projectId?: string | null;
  actions: string[];
  sensitivityMax?: string | null;
  source: string;
};

export type AgentRightsActor = {
  subjectId: string;
  externalKey?: string | null;
  displayName?: string | null;
  kind?: string | null;
  isOwner: boolean;
  purpose?: string | null;
  allowedTools?: string[] | null;
  scopes: string[];
  capabilities: string[];
  rights: AgentRight[];
};

export type AgentRightsResponse = {
  currentActor: {
    subjectId: string;
    isOwner: boolean;
    actor: ActorMeta;
  };
  actors: AgentRightsActor[];
  backend?: string;
};

export type ReviewQueueItem = {
  id: string;
  title: string;
  content: string;
  status: string;
  projectId?: string | null;
};

export type ProjectRecord = {
  id: string;
  slug: string;
  name: string;
  status: string;
  url?: string | null;
};

export type OutboxPendingItem = {
  id?: string;
  eventType?: string;
  createdAt?: string;
  attempts?: number;
};

export type ExtractionCandidate = {
  title: string;
  content: string;
  memoryType?: string;
  confidence?: number;
};

export type StateSummary = {
  stage: string;
  completed: string;
  next: string;
  active: number;
};

export type BackendMode = 'supabase' | 'memory-store' | 'local';

export function describeBackend(backend: BackendMode): string {
  switch (backend) {
    case 'local':
      return 'Локальный черновик';
    case 'memory-store':
    case 'supabase':
      return 'Память подключена';
    default: {
      const exhaustiveCheck: never = backend;
      return exhaustiveCheck;
    }
  }
}

export function describeMemoryStatus(status: string): string {
  switch (status) {
    case 'candidate':
      return 'Кандидат';
    case 'active':
      return 'Активна';
    case 'verified':
      return 'Подтверждена';
    case 'disputed':
      return 'Спорная';
    case 'superseded':
      return 'Замещена';
    case 'retracted':
      return 'Отозвана';
    case 'deleted':
      return 'Удалена';
    default:
      return status;
  }
}

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function describeConnectionStatus(status?: string): string {
  switch (status) {
    case 'connected':
      return 'Подключено';
    case 'degraded':
      return 'С ошибками';
    case 'reauth_required':
      return 'Нужна повторная авторизация';
    case 'revoked':
      return 'Доступ отозван';
    case 'disabled':
      return 'Отключено';
    case undefined:
      return 'Статус неизвестен';
    default:
      return status;
  }
}

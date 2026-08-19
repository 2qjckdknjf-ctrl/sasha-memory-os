export const PROJECT_ID = '44444444-4444-4444-8444-444444444401';
export const PROJECT_NAME = 'AISTROYKA';
export const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
export const CURSOR = '33333333-3333-4333-8333-333333333303';
export const CHATGPT = '33333333-3333-4333-8333-333333333302';

export type Actor = 'owner' | 'chatgpt' | 'cursor';

export const ACTOR_IDS: Record<Actor, string> = {
  owner: '33333333-3333-4333-8333-333333333301',
  chatgpt: CHATGPT,
  cursor: CURSOR,
};

export const ACTOR_LABELS: Record<Actor, string> = {
  owner: 'Owner',
  chatgpt: 'ChatGPT',
  cursor: 'Cursor',
};

export type TimelineEntry =
  | { kind: 'decision'; at: string; title: string; content: string; status: string }
  | { kind: 'state'; at: string; summary: string; version: number; next: string }
  | { kind: 'handoff'; at: string; summary: string };

export type RemoteContext = {
  decisions?: Array<Record<string, unknown>>;
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
  };
  reason?: string;
  score?: number;
};

export type ConnectionRecord = {
  id?: string;
  connectorId?: string;
  displayName?: string;
  status?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  vaultRef?: string | null;
};

export type ReviewQueueItem = {
  id: string;
  title: string;
  content: string;
  status: string;
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

export function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

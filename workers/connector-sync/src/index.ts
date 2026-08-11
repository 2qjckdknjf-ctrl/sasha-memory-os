import { pullGithubStubDelta } from '@memory-os/connector-github';
import { pullGmailStubDelta } from '@memory-os/connector-gmail';
import { pullGoogleDriveStubDelta } from '@memory-os/connector-google-drive';
import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';

export const packageName = 'worker-connector-sync' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
const PROJECT_ID =
  process.env.MEMORY_OS_PROJECT_ID ??
  '44444444-4444-4444-8444-444444444401';
const OWNER_ID =
  process.env.MEMORY_OS_OWNER_SUBJECT_ID ??
  '33333333-3333-4333-8333-333333333301';

export type SyncPlanItem = {
  connectionId: string;
  connectorId: string;
  jobId?: string;
  eventId?: string;
};

export type SyncPlan = {
  count: number;
  enqueued: SyncPlanItem[];
  captured: number;
  completed: Array<{ jobId: string; status: string; connectionId: string | null }>;
};

function requireGateway(
  gateway?: SupabaseMemoryGateway,
): SupabaseMemoryGateway {
  if (gateway) return gateway;
  const env = loadMemoryOsEnv();
  if (!env) {
    throw new Error(
      'Missing MEMORY_OS_SUPABASE_URL / ANON_KEY / API_SECRET for connector-sync',
    );
  }
  return new SupabaseMemoryGateway(createMemoryOsClient(env), env.apiSecret);
}

function pullStubDelta(item: SyncPlanItem) {
  switch (item.connectorId) {
    case 'github':
      return pullGithubStubDelta({
        connectionId: item.connectionId,
        displayName: item.connectorId,
      });
    case 'google-drive':
      return pullGoogleDriveStubDelta({
        connectionId: item.connectionId,
        displayName: item.connectorId,
      });
    case 'gmail':
      return pullGmailStubDelta({
        connectionId: item.connectionId,
        displayName: item.connectorId,
      });
    default:
      return null;
  }
}

async function ingestConnectorDelta(
  gateway: SupabaseMemoryGateway,
  subjectId: string,
  workspaceId: string,
  item: SyncPlanItem,
): Promise<number> {
  const delta = pullStubDelta(item);
  if (!delta) return 0;
  let captured = 0;
  for (const event of delta.items) {
    await gateway.captureText({
      subjectId,
      workspaceId,
      projectId: PROJECT_ID,
      title: event.title,
      text: event.text,
      idempotencyKey: `connector-sync/${item.connectionId}/${event.externalId}`,
      processNow: true,
      filename: `${item.connectorId}://${event.externalId}`,
      mimeType: 'text/plain',
    });
    captured += 1;
  }
  return captured;
}

export async function planConnectorSync(options?: {
  workspaceId?: string;
  subjectId?: string;
  connectionId?: string | null;
  gateway?: SupabaseMemoryGateway;
  ingest?: boolean;
}): Promise<SyncPlan> {
  const gateway = requireGateway(options?.gateway);
  const subjectId = options?.subjectId ?? OWNER_ID;
  const workspaceId = options?.workspaceId ?? WORKSPACE_ID;
  const result = await gateway.enqueueConnectorSync({
    subjectId,
    workspaceId,
    connectionId: options?.connectionId ?? null,
  });

  const completed: SyncPlan['completed'] = [];
  let captured = 0;
  const ingest = options?.ingest !== false;

  for (const item of result.enqueued ?? []) {
    if (!item.jobId) continue;
    try {
      if (ingest) {
        captured += await ingestConnectorDelta(
          gateway,
          subjectId,
          workspaceId,
          item,
        );
      }
      const done = await gateway.completeConnectorSync({
        subjectId,
        jobId: item.jobId,
        status: 'succeeded',
      });
      completed.push({
        jobId: done.jobId,
        status: done.status,
        connectionId: done.connectionId,
      });
      console.log(
        JSON.stringify({
          event: 'connector_sync_completed',
          connectorId: item.connectorId,
          ...done,
          note: 'stub delta ingested; vault credentials not read',
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const done = await gateway.completeConnectorSync({
        subjectId,
        jobId: item.jobId,
        status: 'failed',
        error: message,
      });
      completed.push({
        jobId: done.jobId,
        status: done.status,
        connectionId: done.connectionId,
      });
    }
  }

  return {
    count: result.count ?? 0,
    enqueued: result.enqueued ?? [],
    captured,
    completed,
  };
}

/** One-shot tick used by CLI / cron. */
export async function runConnectorSyncOnce(): Promise<SyncPlan> {
  return planConnectorSync();
}

const isDirectRun = process.argv[1]?.includes('connector-sync');
if (isDirectRun) {
  void runConnectorSyncOnce()
    .then((plan) => {
      console.log(JSON.stringify({ ok: true, ...plan }));
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}

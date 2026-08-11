import {
  createMemoryOsClient,
  loadMemoryOsEnv,
  SupabaseMemoryGateway,
} from '@memory-os/db';

export const packageName = 'worker-connector-sync' as const;

const WORKSPACE_ID =
  process.env.MEMORY_OS_WORKSPACE_ID ??
  '11111111-1111-4111-8111-111111111111';
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

export async function planConnectorSync(options?: {
  workspaceId?: string;
  subjectId?: string;
  connectionId?: string | null;
  gateway?: SupabaseMemoryGateway;
}): Promise<SyncPlan> {
  const gateway = requireGateway(options?.gateway);
  const subjectId = options?.subjectId ?? OWNER_ID;
  const result = await gateway.enqueueConnectorSync({
    subjectId,
    workspaceId: options?.workspaceId ?? WORKSPACE_ID,
    connectionId: options?.connectionId ?? null,
  });

  const completed: SyncPlan['completed'] = [];
  for (const item of result.enqueued ?? []) {
    if (!item.jobId) continue;
    // Stub provider pull: mark succeeded without reading vault material.
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
        note: 'stub complete; vault token not loaded',
      }),
    );
  }

  return {
    count: result.count ?? 0,
    enqueued: result.enqueued ?? [],
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

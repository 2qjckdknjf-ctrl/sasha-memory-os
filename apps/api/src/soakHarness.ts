import { CHATGPT_PILOT_TOOLS, DEFAULT_WORKSPACE_ID } from '@memory-os/mcp-gateway';
import { OFFICIAL_M14_SLO_PACK, resolveSloTarget } from '@memory-os/observability';

const CURSOR_SUBJECT_ID = '33333333-3333-4333-8333-333333333303';
const DEFAULT_BASE_URL = 'http://localhost:8787';
const DEFAULT_SEARCH_QUERY = 'Slice 01';
const DEFAULT_CAPTURE_TITLE = 'Bounded soak candidate';
const DEFAULT_CAPTURE_TEXT = 'Bounded soak candidate receipt.';
const DEFAULT_IDEMPOTENCY_NAMESPACE = 'm14-s02-bounded-soak';
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 3;
const DEFAULT_ROUNDS = 2;
const MAX_ROUNDS = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 3_000;
const MAX_REQUEST_TIMEOUT_MS = 4_000;

const SOAK_TARGET_IDS = [
  'api.availability',
  'mcp.availability',
  'search.hybrid',
  'project.state',
  'write.receipt',
] as const;

type SoakTargetId = (typeof SOAK_TARGET_IDS)[number];
type SoakLatencyTargetId = Extract<
  SoakTargetId,
  'search.hybrid' | 'project.state' | 'write.receipt'
>;
type SoakSurface = 'api' | 'mcp';

export const OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION = 'm14-s02-v1' as const;

export const OFFICIAL_M14_BOUNDED_SOAK_RECIPE = {
  version: OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK.version,
  roadmapSections: ['17.2', '17.3', '20.17'],
  targets: SOAK_TARGET_IDS,
  bounds: {
    defaultConcurrency: DEFAULT_CONCURRENCY,
    maxConcurrency: MAX_CONCURRENCY,
    defaultRounds: DEFAULT_ROUNDS,
    maxRounds: MAX_ROUNDS,
    defaultRequestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxRequestTimeoutMs: MAX_REQUEST_TIMEOUT_MS,
  },
  invariants: {
    modeAToolCount: CHATGPT_PILOT_TOOLS.length,
    requireExplicitProjectIdOnWrites: true,
    allowVerifiedWrites: false,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    logPayloadBodies: false,
  },
} as const;

export type BoundedSoakConfigInput = {
  baseUrl?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  apiSecret?: string | null;
  concurrency?: number | null;
  rounds?: number | null;
  requestTimeoutMs?: number | null;
  searchQuery?: string | null;
  captureTitle?: string | null;
  captureText?: string | null;
  idempotencyNamespace?: string | null;
};

export type ResolvedBoundedSoakConfig = {
  baseUrl: string;
  projectId: string;
  workspaceId: string;
  apiSecret: string | null;
  concurrency: number;
  rounds: number;
  requestTimeoutMs: number;
  searchQuery: string;
  captureTitle: string;
  captureText: string;
  idempotencyNamespace: string;
};

export type SoakPreflightReport = {
  apiHealth: {
    backend: string;
    mcpProfile: string;
  };
  mcpHealth: {
    backend: string;
    profile: string;
  };
  modeATools: string[];
};

export type SoakBurstResult = {
  operation: string;
  round: number;
  surface: SoakSurface;
  targetId: SoakLatencyTargetId | null;
  ok: boolean;
  durationMs: number;
  statusCode: number;
  error?: string;
};

export type SoakSummary = {
  totalOperations: number;
  api: {
    total: number;
    failed: number;
    availabilityRatio: number;
  };
  mcp: {
    total: number;
    failed: number;
    availabilityRatio: number;
  };
  targets: Record<
    SoakLatencyTargetId,
    {
      total: number;
      p95Ms: number | null;
      maxMs: number | null;
      thresholdMs: number;
    }
  >;
};

export type BoundedSoakReport = {
  recipeVersion: typeof OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION;
  sloPackVersion: string;
  config: Pick<
    ResolvedBoundedSoakConfig,
    'baseUrl' | 'projectId' | 'workspaceId' | 'concurrency' | 'rounds' | 'requestTimeoutMs'
  >;
  preflight: SoakPreflightReport;
  burst: SoakBurstResult[];
  summary: SoakSummary;
  assertions: {
    ok: boolean;
    errors: string[];
  };
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type SoakClient = {
  request(
    input: string | URL | Request,
    init?: RequestInit | undefined,
  ): Promise<Response>;
};

type SoakOperation = {
  name: string;
  round: number;
  surface: SoakSurface;
  targetId: SoakLatencyTargetId;
  execute(client: SoakClient, config: ResolvedBoundedSoakConfig): Promise<number>;
};

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBaseUrl(value: string | null | undefined): string {
  const trimmed = trimToNull(value) ?? DEFAULT_BASE_URL;
  return trimmed.replace(/\/+$/g, '');
}

function resolvePositiveInteger(input: {
  label: string;
  value: number | null | undefined;
  fallback: number;
  max: number;
}): number {
  const raw = input.value ?? input.fallback;
  if (!Number.isInteger(raw) || raw <= 0) {
    throw new Error(`${input.label} must be a positive integer`);
  }
  if (raw > input.max) {
    throw new Error(`${input.label} must stay <= ${input.max} for the bounded soak recipe`);
  }
  return raw;
}

function sanitizeString(
  value: string,
  sensitiveValues: readonly string[],
): string {
  let sanitized = value;
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue;
    sanitized = sanitized.split(sensitiveValue).join('[REDACTED]');
  }
  return sanitized;
}

function ensureNoLeak(
  serialized: string,
  sensitiveValues: readonly string[],
  context: string,
): void {
  for (const sensitiveValue of sensitiveValues) {
    if (!sensitiveValue) continue;
    if (serialized.includes(sensitiveValue)) {
      throw new Error(`${context} leaked request payload or secret material`);
    }
  }
}

function buildSensitiveValues(config: ResolvedBoundedSoakConfig): string[] {
  return [
    config.apiSecret ?? '',
    config.searchQuery,
    config.captureTitle,
    config.captureText,
  ].filter((value) => value.length > 0);
}

function apiHeaders(config: ResolvedBoundedSoakConfig): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'content-type': 'application/json',
    'x-actor-key': 'cursor',
  });
  if (config.apiSecret) {
    headers.set('x-memory-os-api-secret', config.apiSecret);
  }
  return headers;
}

function mcpHeaders(config: ResolvedBoundedSoakConfig): Headers {
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });
  if (config.apiSecret) {
    headers.set('x-memory-os-api-secret', config.apiSecret);
  }
  return headers;
}

async function requestJson(
  client: SoakClient,
  config: ResolvedBoundedSoakConfig,
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; bodyText: string; bodyJson: unknown }> {
  const signal = AbortSignal.timeout(config.requestTimeoutMs);
  const response = await client.request(`${config.baseUrl}${path}`, {
    ...init,
    signal,
  });
  const bodyText = await response.text();
  let bodyJson: unknown = null;
  if (bodyText.trim().length > 0) {
    bodyJson = JSON.parse(bodyText);
  }
  return { response, bodyText, bodyJson };
}

async function requestRpc(
  client: SoakClient,
  config: ResolvedBoundedSoakConfig,
  input: {
    id: number;
    method: string;
    params?: Record<string, unknown>;
  },
): Promise<{ response: Response; bodyText: string; bodyJson: JsonRpcResponse }> {
  const { response, bodyText, bodyJson } = await requestJson(client, config, '/mcp', {
    method: 'POST',
    headers: mcpHeaders(config),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: input.id,
      method: input.method,
      params: input.params ?? {},
    }),
  });
  return {
    response,
    bodyText,
    bodyJson: bodyJson as JsonRpcResponse,
  };
}

function assertRpcOk(body: JsonRpcResponse, context: string): void {
  if (body.error) {
    throw new Error(`${context} failed: ${body.error.message}`);
  }
  if (!('result' in body)) {
    throw new Error(`${context} returned no JSON-RPC result`);
  }
}

function latencyThresholdMs(targetId: SoakLatencyTargetId): number {
  const target = resolveSloTarget(targetId);
  if (target.objective.kind !== 'latency_p95') {
    throw new Error(`expected latency target for ${targetId}`);
  }
  return target.objective.thresholdMs;
}

function percentile95(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] ?? null;
}

function ratio(successCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  return Number((successCount / totalCount).toFixed(6));
}

function buildBurstOperations(
  config: ResolvedBoundedSoakConfig,
): SoakOperation[] {
  const operations: SoakOperation[] = [];
  for (let round = 1; round <= config.rounds; round += 1) {
    operations.push(
      {
        name: 'api.search',
        round,
        surface: 'api',
        targetId: 'search.hybrid',
        async execute(client) {
          const { response } = await requestJson(client, config, '/v1/search', {
            method: 'POST',
            headers: apiHeaders(config),
            body: JSON.stringify({
              query: config.searchQuery,
              project_id: config.projectId,
            }),
          });
          if (response.status !== 200) {
            throw new Error(`api.search expected 200, got ${response.status}`);
          }
          return response.status;
        },
      },
      {
        name: 'api.project_state',
        round,
        surface: 'api',
        targetId: 'project.state',
        async execute(client) {
          const { response } = await requestJson(
            client,
            config,
            `/v1/projects/${config.projectId}/state`,
            {
              method: 'GET',
              headers: apiHeaders(config),
            },
          );
          if (response.status !== 200) {
            throw new Error(`api.project_state expected 200, got ${response.status}`);
          }
          return response.status;
        },
      },
      {
        name: 'api.capture_text',
        round,
        surface: 'api',
        targetId: 'write.receipt',
        async execute(client) {
          const { response, bodyText } = await requestJson(client, config, '/v1/capture/text', {
            method: 'POST',
            headers: apiHeaders(config),
            body: JSON.stringify({
              workspace_id: config.workspaceId,
              project_id: config.projectId,
              title: config.captureTitle,
              text: config.captureText,
              actor_subject_id: CURSOR_SUBJECT_ID,
              idempotency_key: `${config.idempotencyNamespace}/api-capture`,
              process_now: false,
            }),
          });
          if (response.status !== 201) {
            throw new Error(`api.capture_text expected 201, got ${response.status}`);
          }
          ensureNoLeak(bodyText, buildSensitiveValues(config), 'api.capture_text response');
          return response.status;
        },
      },
      {
        name: 'mcp.memory_search',
        round,
        surface: 'mcp',
        targetId: 'search.hybrid',
        async execute(client) {
          const { response, bodyJson } = await requestRpc(client, config, {
            id: 100 + round,
            method: 'tools/call',
            params: {
              name: 'memory.search',
              arguments: {
                query: config.searchQuery,
                project_id: config.projectId,
                pack_context: true,
              },
            },
          });
          if (response.status !== 200) {
            throw new Error(`mcp.memory_search expected 200, got ${response.status}`);
          }
          assertRpcOk(bodyJson, 'mcp.memory_search');
          return response.status;
        },
      },
      {
        name: 'mcp.context_project',
        round,
        surface: 'mcp',
        targetId: 'project.state',
        async execute(client) {
          const { response, bodyJson } = await requestRpc(client, config, {
            id: 200 + round,
            method: 'tools/call',
            params: {
              name: 'context.project',
              arguments: {
                project_id: config.projectId,
              },
            },
          });
          if (response.status !== 200) {
            throw new Error(`mcp.context_project expected 200, got ${response.status}`);
          }
          assertRpcOk(bodyJson, 'mcp.context_project');
          return response.status;
        },
      },
      {
        name: 'mcp.capture_text',
        round,
        surface: 'mcp',
        targetId: 'write.receipt',
        async execute(client) {
          const { response, bodyText, bodyJson } = await requestRpc(client, config, {
            id: 300 + round,
            method: 'tools/call',
            params: {
              name: 'capture.text',
              arguments: {
                project_id: config.projectId,
                title: config.captureTitle,
                text: config.captureText,
                idempotency_key: `${config.idempotencyNamespace}/mcp-capture`,
                process_now: false,
              },
            },
          });
          if (response.status !== 200) {
            throw new Error(`mcp.capture_text expected 200, got ${response.status}`);
          }
          assertRpcOk(bodyJson, 'mcp.capture_text');
          ensureNoLeak(bodyText, buildSensitiveValues(config), 'mcp.capture_text response');
          return response.status;
        },
      },
    );
  }
  return operations;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (!current) break;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function runPreflight(
  client: SoakClient,
  config: ResolvedBoundedSoakConfig,
): Promise<SoakPreflightReport> {
  const health = await requestJson(client, config, '/health', {
    method: 'GET',
    headers: apiHeaders(config),
  });
  if (health.response.status !== 200) {
    throw new Error(`/health expected 200, got ${health.response.status}`);
  }
  const healthBody = health.bodyJson as { ok?: boolean; backend?: string; mcpProfile?: string };
  if (healthBody.ok !== true) {
    throw new Error('/health did not report ok=true');
  }

  const mcpHealth = await requestJson(client, config, '/mcp/health', {
    method: 'GET',
    headers: mcpHeaders(config),
  });
  if (mcpHealth.response.status !== 200) {
    throw new Error(`/mcp/health expected 200, got ${mcpHealth.response.status}`);
  }
  const mcpHealthBody = mcpHealth.bodyJson as { ok?: boolean; backend?: string; profile?: string };
  if (mcpHealthBody.ok !== true) {
    throw new Error('/mcp/health did not report ok=true');
  }
  if (mcpHealthBody.profile !== 'chatgpt') {
    throw new Error(`/mcp/health expected chatgpt profile, got ${mcpHealthBody.profile ?? 'unknown'}`);
  }

  const mcpGet = await requestJson(client, config, '/mcp', {
    method: 'GET',
    headers: mcpHeaders(config),
  });
  if (mcpGet.response.status !== 405) {
    throw new Error(`/mcp GET expected 405, got ${mcpGet.response.status}`);
  }

  const initialize = await requestRpc(client, config, {
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26' },
  });
  if (initialize.response.status !== 200) {
    throw new Error(`initialize expected 200, got ${initialize.response.status}`);
  }
  assertRpcOk(initialize.bodyJson, 'initialize');
  const initializeResult = initialize.bodyJson.result as {
    protocolVersion?: string;
    serverInfo?: { profile?: string };
  };
  if (initializeResult.protocolVersion !== '2025-03-26') {
    throw new Error(`initialize expected protocol 2025-03-26, got ${initializeResult.protocolVersion ?? 'unknown'}`);
  }
  if (initializeResult.serverInfo?.profile !== 'chatgpt') {
    throw new Error(
      `initialize expected chatgpt server profile, got ${initializeResult.serverInfo?.profile ?? 'unknown'}`,
    );
  }

  const listed = await requestRpc(client, config, {
    id: 2,
    method: 'tools/list',
  });
  if (listed.response.status !== 200) {
    throw new Error(`tools/list expected 200, got ${listed.response.status}`);
  }
  assertRpcOk(listed.bodyJson, 'tools/list');
  const listedTools = (
    (listed.bodyJson.result as { tools?: Array<{ name?: string }> }).tools ?? []
  )
    .map((tool) => String(tool.name ?? ''))
    .sort();
  const expectedTools = [...CHATGPT_PILOT_TOOLS].sort();
  if (JSON.stringify(listedTools) !== JSON.stringify(expectedTools)) {
    throw new Error(
      `ChatGPT Mode A tool surface changed: expected ${expectedTools.length} tools, got ${listedTools.length}`,
    );
  }

  return {
    apiHealth: {
      backend: String(healthBody.backend ?? 'unknown'),
      mcpProfile: String(healthBody.mcpProfile ?? 'unknown'),
    },
    mcpHealth: {
      backend: String(mcpHealthBody.backend ?? 'unknown'),
      profile: String(mcpHealthBody.profile ?? 'unknown'),
    },
    modeATools: listedTools,
  };
}

function summarizeBurst(results: readonly SoakBurstResult[]): SoakSummary {
  const apiResults = results.filter((result) => result.surface === 'api');
  const mcpResults = results.filter((result) => result.surface === 'mcp');
  const latencyTargets: SoakLatencyTargetId[] = [
    'search.hybrid',
    'project.state',
    'write.receipt',
  ];

  const targets = Object.fromEntries(
    latencyTargets.map((targetId) => {
      const durations = results
        .filter((result) => result.ok && result.targetId === targetId)
        .map((result) => result.durationMs);
      return [
        targetId,
        {
          total: durations.length,
          p95Ms: percentile95(durations),
          maxMs: durations.length > 0 ? Math.max(...durations) : null,
          thresholdMs: latencyThresholdMs(targetId),
        },
      ];
    }),
  ) as SoakSummary['targets'];

  return {
    totalOperations: results.length,
    api: {
      total: apiResults.length,
      failed: apiResults.filter((result) => !result.ok).length,
      availabilityRatio: ratio(
        apiResults.filter((result) => result.ok).length,
        apiResults.length,
      ),
    },
    mcp: {
      total: mcpResults.length,
      failed: mcpResults.filter((result) => !result.ok).length,
      availabilityRatio: ratio(
        mcpResults.filter((result) => result.ok).length,
        mcpResults.length,
      ),
    },
    targets,
  };
}

export function resolveBoundedSoakConfig(
  input: BoundedSoakConfigInput,
): ResolvedBoundedSoakConfig {
  const projectId = trimToNull(input.projectId);
  if (!projectId) {
    throw new Error(
      'explicit project_id is required for the bounded soak recipe; no default project fallback',
    );
  }
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    projectId,
    workspaceId: trimToNull(input.workspaceId) ?? DEFAULT_WORKSPACE_ID,
    apiSecret: trimToNull(input.apiSecret),
    concurrency: resolvePositiveInteger({
      label: 'concurrency',
      value: input.concurrency,
      fallback: DEFAULT_CONCURRENCY,
      max: MAX_CONCURRENCY,
    }),
    rounds: resolvePositiveInteger({
      label: 'rounds',
      value: input.rounds,
      fallback: DEFAULT_ROUNDS,
      max: MAX_ROUNDS,
    }),
    requestTimeoutMs: resolvePositiveInteger({
      label: 'requestTimeoutMs',
      value: input.requestTimeoutMs,
      fallback: DEFAULT_REQUEST_TIMEOUT_MS,
      max: MAX_REQUEST_TIMEOUT_MS,
    }),
    searchQuery: trimToNull(input.searchQuery) ?? DEFAULT_SEARCH_QUERY,
    captureTitle: trimToNull(input.captureTitle) ?? DEFAULT_CAPTURE_TITLE,
    captureText: trimToNull(input.captureText) ?? DEFAULT_CAPTURE_TEXT,
    idempotencyNamespace:
      trimToNull(input.idempotencyNamespace) ?? DEFAULT_IDEMPOTENCY_NAMESPACE,
  };
}

export function resolveBoundedSoakConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBoundedSoakConfig {
  return resolveBoundedSoakConfig({
    baseUrl: env.MEMORY_OS_API_BASE_URL,
    projectId: env.MEMORY_OS_SOAK_PROJECT_ID ?? env.MEMORY_OS_PROJECT_ID,
    workspaceId: env.MEMORY_OS_WORKSPACE_ID ?? env.MEMORY_OS_DEFAULT_WORKSPACE_ID,
    apiSecret: env.MEMORY_OS_API_SECRET,
    concurrency: env.MEMORY_OS_SOAK_CONCURRENCY
      ? Number(env.MEMORY_OS_SOAK_CONCURRENCY)
      : null,
    rounds: env.MEMORY_OS_SOAK_ROUNDS ? Number(env.MEMORY_OS_SOAK_ROUNDS) : null,
    requestTimeoutMs: env.MEMORY_OS_SOAK_TIMEOUT_MS
      ? Number(env.MEMORY_OS_SOAK_TIMEOUT_MS)
      : null,
    searchQuery: env.MEMORY_OS_SOAK_QUERY,
    captureTitle: env.MEMORY_OS_SOAK_TITLE,
    captureText: env.MEMORY_OS_SOAK_TEXT,
    idempotencyNamespace: env.MEMORY_OS_SOAK_NAMESPACE,
  });
}

export function evaluateBoundedSoakReport(
  report: Pick<BoundedSoakReport, 'summary' | 'preflight'>,
): string[] {
  const errors: string[] = [];
  const apiAvailabilityTarget = resolveSloTarget('api.availability');
  const mcpAvailabilityTarget = resolveSloTarget('mcp.availability');
  if (
    apiAvailabilityTarget.objective.kind !== 'availability' ||
    mcpAvailabilityTarget.objective.kind !== 'availability'
  ) {
    throw new Error('expected availability targets in official SLO pack');
  }

  const apiErrorRatio = Number((1 - report.summary.api.availabilityRatio).toFixed(6));
  if (apiErrorRatio > apiAvailabilityTarget.objective.errorBudgetRatio) {
    errors.push(
      `api availability budget exhausted (${apiErrorRatio} > ${apiAvailabilityTarget.objective.errorBudgetRatio})`,
    );
  }

  const mcpErrorRatio = Number((1 - report.summary.mcp.availabilityRatio).toFixed(6));
  if (mcpErrorRatio > mcpAvailabilityTarget.objective.errorBudgetRatio) {
    errors.push(
      `mcp availability budget exhausted (${mcpErrorRatio} > ${mcpAvailabilityTarget.objective.errorBudgetRatio})`,
    );
  }

  for (const targetId of ['search.hybrid', 'project.state', 'write.receipt'] as const) {
    const targetSummary = report.summary.targets[targetId];
    if (targetSummary.total === 0) {
      errors.push(`${targetId} recorded no successful samples`);
      continue;
    }
    if ((targetSummary.p95Ms ?? Number.POSITIVE_INFINITY) > targetSummary.thresholdMs) {
      errors.push(
        `${targetId} p95 exceeded threshold (${targetSummary.p95Ms}ms > ${targetSummary.thresholdMs}ms)`,
      );
    }
  }

  const actualModeATools = report.preflight.modeATools.length;
  if (actualModeATools !== CHATGPT_PILOT_TOOLS.length) {
    errors.push(
      `ChatGPT Mode A tool count changed (${actualModeATools} !== ${CHATGPT_PILOT_TOOLS.length})`,
    );
  }

  return errors;
}

export function assertBoundedSoakReport(
  report: Pick<BoundedSoakReport, 'summary' | 'preflight'>,
): void {
  const errors = evaluateBoundedSoakReport(report);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

export async function runBoundedSoakRecipe(
  client: SoakClient,
  input: BoundedSoakConfigInput,
): Promise<BoundedSoakReport> {
  const config = resolveBoundedSoakConfig(input);
  const preflight = await runPreflight(client, config);
  const burstOperations = buildBurstOperations(config);
  const sensitiveValues = buildSensitiveValues(config);
  const burst: SoakBurstResult[] = [];

  await runWithConcurrency(burstOperations, config.concurrency, async (operation) => {
    const startedAt = Date.now();
    try {
      const statusCode = await operation.execute(client, config);
      burst.push({
        operation: operation.name,
        round: operation.round,
        surface: operation.surface,
        targetId: operation.targetId,
        ok: true,
        durationMs: Date.now() - startedAt,
        statusCode,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `unexpected soak error: ${String(err)}`;
      burst.push({
        operation: operation.name,
        round: operation.round,
        surface: operation.surface,
        targetId: operation.targetId,
        ok: false,
        durationMs: Date.now() - startedAt,
        statusCode: 500,
        error: sanitizeString(message, sensitiveValues),
      });
    }
  });

  burst.sort((left, right) => {
    if (left.round !== right.round) return left.round - right.round;
    return left.operation.localeCompare(right.operation);
  });

  const summary = summarizeBurst(burst);
  const report: BoundedSoakReport = {
    recipeVersion: OFFICIAL_M14_BOUNDED_SOAK_RECIPE_VERSION,
    sloPackVersion: OFFICIAL_M14_SLO_PACK.version,
    config: {
      baseUrl: config.baseUrl,
      projectId: config.projectId,
      workspaceId: config.workspaceId,
      concurrency: config.concurrency,
      rounds: config.rounds,
      requestTimeoutMs: config.requestTimeoutMs,
    },
    preflight,
    burst,
    summary,
    assertions: {
      ok: true,
      errors: [],
    },
  };
  const errors = evaluateBoundedSoakReport(report);
  report.assertions.ok = errors.length === 0;
  report.assertions.errors = errors;
  return report;
}

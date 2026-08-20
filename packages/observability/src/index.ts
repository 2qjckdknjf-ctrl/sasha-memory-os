export const packageName = 'observability' as const;

export type LogFields = Record<string, unknown>;

export const REDACTED_LOG_VALUE = '[REDACTED]' as const;
export const OFFICIAL_M14_SLO_PACK_VERSION = 'm14-s01-v1' as const;
export const OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION = 'm14-s03-v1' as const;

const LATENCY_P95_ERROR_BUDGET_RATIO = 0.05;
const MAX_SLO_SAMPLES_PER_TARGET = 1_024;
const SAFE_RAW_STRING_KEYS = new Set([
  'action',
  'connectorId',
  'errorClass',
  'id',
  'kind',
  'level',
  'method',
  'mode',
  'msg',
  'objectId',
  'objectType',
  'operation',
  'outcome',
  'path',
  'profile',
  'reason',
  'requestId',
  'route',
  'service',
  'status',
  'surface',
  'targetId',
  'toolName',
  'workspaceId',
]);
const SAFE_STATUS_TEXT_PATTERN = /^[a-z0-9_.:/-]+$/i;
const SENSITIVE_FIELD_NAME_PATTERN =
  /(?:^|[_-])(token|secret|password|authorization|cookie|content|text|body|payload|query|prompt|context|memory|personal|email|subject|message|title)(?:[_-]|$)/i;

type AvailabilitySloTarget = {
  id: 'api.availability' | 'mcp.availability';
  surface: 'api' | 'mcp';
  description: string;
  objective: {
    kind: 'availability';
    targetRatio: number;
    errorBudgetRatio: number;
  };
};

type LatencySloTarget = {
  id:
    | 'project.state'
    | 'search.hybrid'
    | 'search.agentic'
    | 'write.receipt';
  surface: 'api' | 'mcp';
  description: string;
  objective: {
    kind: 'latency_p95';
    thresholdMs: number;
    errorBudgetRatio: number;
  };
};

type DeadlineSloTarget = {
  id: 'webhook.ack';
  surface: 'api';
  description: string;
  objective: {
    kind: 'deadline';
    thresholdMs: number;
    errorBudgetRatio: 0;
  };
};

type ZeroToleranceSloTarget = {
  id: 'acl.leakage';
  surface: 'security';
  description: string;
  objective: {
    kind: 'zero_tolerance';
    maxViolations: 0;
  };
};

export type SloTarget =
  | AvailabilitySloTarget
  | LatencySloTarget
  | DeadlineSloTarget
  | ZeroToleranceSloTarget;

export type SloTargetId = SloTarget['id'];
export type SloObservationOutcome = 'ok' | 'error' | 'violation';

export const OFFICIAL_M14_SLO_PACK = {
  version: OFFICIAL_M14_SLO_PACK_VERSION,
  roadmapSections: ['17.2', '17.4', '20.17'],
  targets: [
    {
      id: 'api.availability',
      surface: 'api',
      description: 'API availability on handled request paths.',
      objective: {
        kind: 'availability',
        targetRatio: 0.995,
        errorBudgetRatio: 0.005,
      },
    },
    {
      id: 'mcp.availability',
      surface: 'mcp',
      description: 'MCP availability on handled gateway tool calls.',
      objective: {
        kind: 'availability',
        targetRatio: 0.995,
        errorBudgetRatio: 0.005,
      },
    },
    {
      id: 'project.state',
      surface: 'api',
      description: 'project.state latency p95 on current stack.',
      objective: {
        kind: 'latency_p95',
        thresholdMs: 700,
        errorBudgetRatio: LATENCY_P95_ERROR_BUDGET_RATIO,
      },
    },
    {
      id: 'search.hybrid',
      surface: 'api',
      description: 'Hybrid search latency p95 on current stack.',
      objective: {
        kind: 'latency_p95',
        thresholdMs: 2_000,
        errorBudgetRatio: LATENCY_P95_ERROR_BUDGET_RATIO,
      },
    },
    {
      id: 'search.agentic',
      surface: 'api',
      description: 'Bounded agentic retrieval latency p95 on current stack.',
      objective: {
        kind: 'latency_p95',
        thresholdMs: 8_000,
        errorBudgetRatio: LATENCY_P95_ERROR_BUDGET_RATIO,
      },
    },
    {
      id: 'write.receipt',
      surface: 'api',
      description: 'Durable write receipt latency p95 on current stack.',
      objective: {
        kind: 'latency_p95',
        thresholdMs: 1_000,
        errorBudgetRatio: LATENCY_P95_ERROR_BUDGET_RATIO,
      },
    },
    {
      id: 'webhook.ack',
      surface: 'api',
      description: 'Webhook acknowledgement deadline on the current receiver path.',
      objective: {
        kind: 'deadline',
        thresholdMs: 5_000,
        errorBudgetRatio: 0,
      },
    },
    {
      id: 'acl.leakage',
      surface: 'security',
      description: 'Confirmed ACL leakage incidents.',
      objective: {
        kind: 'zero_tolerance',
        maxViolations: 0,
      },
    },
  ] satisfies readonly SloTarget[],
} as const;

type SecurityReviewChecklistItemId =
  | 'rls-matrix'
  | 'acl-default-deny'
  | 'mcp-unauthenticated-reject'
  | 'mode-a-surface'
  | 'no-owner-token-bypass'
  | 'no-aistroyka-fallback'
  | 'no-verified-write-or-payload-leak';

type SecurityReviewChecklistItem = {
  id: SecurityReviewChecklistItemId;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_SECURITY_REVIEW_PACK = {
  version: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  roadmapSections: ['20.17'],
  checklist: [
    {
      id: 'rls-matrix',
      description:
        'RLS stays deny-first for wrong-workspace, cross-project, personal-sensitivity, and append-only cases.',
      defensiveOnly: true,
      evidence: [
        'tests/security/rls_matrix.test.ts',
        'tests/security/rls_policy_cases.sql',
        'docs/engineering/RLS_MATRIX.md',
        'apps/api/src/supabase.rls.test.ts',
      ],
    },
    {
      id: 'acl-default-deny',
      description:
        'ACL checks stay fail-closed: personal memory remains denied by default and unrelated projects stay unreadable.',
      defensiveOnly: true,
      evidence: [
        'packages/authz/src/index.test.ts',
        'apps/mcp-gateway/src/tools.test.ts',
      ],
    },
    {
      id: 'mcp-unauthenticated-reject',
      description:
        'Unauthenticated MCP HTTP transport stays rejected whenever API auth is enforced.',
      defensiveOnly: true,
      evidence: [
        'apps/mcp-gateway/src/http.ts',
        'apps/mcp-gateway/src/httpAuth.test.ts',
      ],
    },
    {
      id: 'mode-a-surface',
      description: 'ChatGPT Mode A stays at exactly 7 tools with no new owner or ops surface.',
      defensiveOnly: true,
      evidence: [
        'apps/mcp-gateway/src/profile.ts',
        'apps/mcp-gateway/src/profile.test.ts',
      ],
    },
    {
      id: 'no-owner-token-bypass',
      description:
        'Review-only slices do not add owner-token bypasses or new privileged write paths.',
      defensiveOnly: true,
      evidence: [
        'apps/api/src/soakHarness.test.ts',
        'apps/mcp-gateway/src/profile.test.ts',
      ],
    },
    {
      id: 'no-aistroyka-fallback',
      description:
        'Writes and bounded agentic paths require explicit project scope and never fall back to AISTROYKA.',
      defensiveOnly: true,
      evidence: [
        'apps/api/src/app.test.ts',
        'apps/mcp-gateway/src/tools.test.ts',
        'workers/consolidation/src/index.test.ts',
      ],
    },
    {
      id: 'no-verified-write-or-payload-leak',
      description:
        'Security review coverage adds no verified-memory writes and does not log memory bodies or tokens.',
      defensiveOnly: true,
      evidence: [
        'packages/observability/src/index.test.ts',
        'apps/api/src/app.test.ts',
        'apps/mcp-gateway/src/tools.test.ts',
      ],
    },
  ] satisfies readonly SecurityReviewChecklistItem[],
  invariants: {
    defensiveOnly: true,
    modeAToolCount: 7,
    requireExplicitProjectIdOnWrites: true,
    rejectUnauthenticatedMcp: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    logMemoryBodies: false,
    logTokens: false,
  },
} as const;

type RuntimeTargetState = {
  totalCount: number;
  successCount: number;
  errorCount: number;
  violationCount: number;
  slowCount: number;
  lateCount: number;
  durationsMs: number[];
  lastRecordedAt: string | null;
};

const sloState = new Map<SloTargetId, RuntimeTargetState>();
const sloTargetById = new Map<SloTargetId, SloTarget>(
  OFFICIAL_M14_SLO_PACK.targets.map((target) => [target.id, target]),
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStringValue(key: string, value: string): string {
  if (SAFE_RAW_STRING_KEYS.has(key)) {
    return value;
  }
  if (/error|message/i.test(key)) {
    return SAFE_STATUS_TEXT_PATTERN.test(value.trim())
      ? value.trim()
      : REDACTED_LOG_VALUE;
  }
  return REDACTED_LOG_VALUE;
}

function sanitizeFieldValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return sanitizeStringValue(key, value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFieldValue(key, item));
  }
  if (isPlainObject(value)) {
    return sanitizeObjectFields(value);
  }
  return String(value);
}

function sanitizeObjectFields(fields: LogFields): LogFields {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_FIELD_NAME_PATTERN.test(key)) {
      sanitized[key] = REDACTED_LOG_VALUE;
      continue;
    }
    sanitized[key] = sanitizeFieldValue(key, value);
  }
  return sanitized;
}

export function sanitizeLogFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  return sanitizeObjectFields(fields);
}

function writeStructuredLog(
  level: 'info' | 'warn' | 'error',
  service: string,
  msg: string,
  fields?: LogFields,
): void {
  const payload = JSON.stringify({
    level,
    service,
    msg,
    ...(sanitizeLogFields(fields) ?? {}),
  });
  switch (level) {
    case 'warn':
      console.warn(payload);
      return;
    case 'error':
      console.error(payload);
      return;
    default:
      console.log(payload);
  }
}

/** Minimal structured logger (JSON lines). No secrets or personal content. */
export function createLogger(service: string) {
  return {
    info(msg: string, fields?: LogFields): void {
      writeStructuredLog('info', service, msg, fields);
    },
    warn(msg: string, fields?: LogFields): void {
      writeStructuredLog('warn', service, msg, fields);
    },
    error(msg: string, fields?: LogFields): void {
      writeStructuredLog('error', service, msg, fields);
    },
  };
}

function runtimeTargetState(targetId: SloTargetId): RuntimeTargetState {
  const existing = sloState.get(targetId);
  if (existing) return existing;
  const created: RuntimeTargetState = {
    totalCount: 0,
    successCount: 0,
    errorCount: 0,
    violationCount: 0,
    slowCount: 0,
    lateCount: 0,
    durationsMs: [],
    lastRecordedAt: null,
  };
  sloState.set(targetId, created);
  return created;
}

function appendDurationSample(state: RuntimeTargetState, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  if (state.durationsMs.length >= MAX_SLO_SAMPLES_PER_TARGET) {
    state.durationsMs.shift();
  }
  state.durationsMs.push(Math.round(durationMs));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function percentile95(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] ?? null;
}

function budgetRemainingRatio(allowedRatio: number, actualRatio: number): number {
  return Number((allowedRatio - actualRatio).toFixed(6));
}

export function resolveSloTarget(targetId: SloTargetId): SloTarget {
  const target = sloTargetById.get(targetId);
  if (!target) {
    throw new Error(`unknown SLO target: ${targetId}`);
  }
  return target;
}

export function recordSloObservation(input: {
  targetId: SloTargetId;
  durationMs?: number;
  outcome?: SloObservationOutcome;
}): void {
  const target = resolveSloTarget(input.targetId);
  const state = runtimeTargetState(target.id);
  const outcome = input.outcome ?? 'ok';

  state.totalCount += 1;
  state.lastRecordedAt = new Date().toISOString();
  if (outcome === 'error') {
    state.errorCount += 1;
  } else {
    state.successCount += 1;
  }
  if (outcome === 'violation') {
    state.violationCount += 1;
  }

  if (typeof input.durationMs === 'number') {
    appendDurationSample(state, input.durationMs);
    if (
      target.objective.kind === 'latency_p95' &&
      input.durationMs > target.objective.thresholdMs
    ) {
      state.slowCount += 1;
    }
    if (
      target.objective.kind === 'deadline' &&
      input.durationMs > target.objective.thresholdMs
    ) {
      state.lateCount += 1;
    }
  }
}

export function recordHandledAvailability(input: {
  targetId: Extract<SloTargetId, 'api.availability' | 'mcp.availability'>;
  statusCode: number;
  durationMs: number;
}): void {
  recordSloObservation({
    targetId: input.targetId,
    durationMs: input.durationMs,
    outcome: input.statusCode >= 500 ? 'error' : 'ok',
  });
}

export function resetSloObservations(): void {
  sloState.clear();
}

export function getSloBudgetSnapshot() {
  return {
    version: OFFICIAL_M14_SLO_PACK.version,
    generatedAt: new Date().toISOString(),
    targets: OFFICIAL_M14_SLO_PACK.targets.map((target) => {
      const state = runtimeTargetState(target.id);
      const sampleCount = state.durationsMs.length;
      const p95Ms = percentile95(state.durationsMs);
      const maxMs =
        sampleCount > 0 ? Math.max(...state.durationsMs) : null;

      switch (target.objective.kind) {
        case 'availability': {
          const errorRatio = ratio(state.errorCount, state.totalCount);
          return {
            id: target.id,
            surface: target.surface,
            description: target.description,
            objective: target.objective,
            observations: {
              totalCount: state.totalCount,
              successCount: state.successCount,
              errorCount: state.errorCount,
              availabilityRatio: ratio(state.successCount, state.totalCount),
              errorRatio,
              budgetRemainingRatio: budgetRemainingRatio(
                target.objective.errorBudgetRatio,
                errorRatio,
              ),
              lastRecordedAt: state.lastRecordedAt,
            },
          };
        }
        case 'latency_p95': {
          const slowRatio = ratio(state.slowCount, Math.max(sampleCount, state.totalCount));
          return {
            id: target.id,
            surface: target.surface,
            description: target.description,
            objective: target.objective,
            observations: {
              totalCount: state.totalCount,
              successCount: state.successCount,
              errorCount: state.errorCount,
              sampleCount,
              p95Ms,
              maxMs,
              slowCount: state.slowCount,
              slowRatio,
              budgetRemainingRatio: budgetRemainingRatio(
                target.objective.errorBudgetRatio,
                slowRatio,
              ),
              lastRecordedAt: state.lastRecordedAt,
            },
          };
        }
        case 'deadline': {
          const lateRatio = ratio(state.lateCount, Math.max(sampleCount, state.totalCount));
          return {
            id: target.id,
            surface: target.surface,
            description: target.description,
            objective: target.objective,
            observations: {
              totalCount: state.totalCount,
              successCount: state.successCount,
              errorCount: state.errorCount,
              sampleCount,
              maxMs,
              lateCount: state.lateCount,
              lateRatio,
              budgetRemainingRatio: budgetRemainingRatio(
                target.objective.errorBudgetRatio,
                lateRatio,
              ),
              lastRecordedAt: state.lastRecordedAt,
            },
          };
        }
        case 'zero_tolerance':
          return {
            id: target.id,
            surface: target.surface,
            description: target.description,
            objective: target.objective,
            observations: {
              totalCount: state.totalCount,
              violationCount: state.violationCount,
              budgetRemainingCount: target.objective.maxViolations - state.violationCount,
              lastRecordedAt: state.lastRecordedAt,
            },
          };
        default: {
          const exhaustive: never = target.objective;
          throw new Error(`unhandled SLO objective ${(exhaustive as { kind?: string }).kind ?? 'unknown'}`);
        }
      }
    }),
  };
}

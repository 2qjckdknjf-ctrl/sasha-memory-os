export const OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK_VERSION =
  'm20-s03-v1' as const;

export const OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK = {
  version: OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK_VERSION,
  goal: 'prove retrieval quality and bounded performance on the current GA stack',
  requiredGates: [
    'frozen-200-case-retrieval-eval',
    'recall-at-10-floor',
    'zero-acl-leakage',
    'm13-agentic-regression',
    'bounded-api-mcp-soak',
    'routing-and-idempotency-under-load',
    'live-read-only-retrieval-latency',
  ],
  thresholds: {
    frozenCaseCount: 200,
    recallAt10Floor: 0.95,
    aclLeakageCasesMax: 0,
    routingPrecisionFloor: 0.95,
    soakOperationsFloor: 60,
    liveReadOnlySamples: 12,
    hybridP95Ms: 2_000,
    agenticP95Ms: 8_000,
  },
  invariants: {
    reuseM14SloPack: true,
    preserveM13RankingVersion: true,
    agenticRetrievalMayWrite: false,
    routingMustFailClosed: true,
    idempotencyScopeMismatchMustFail: true,
    explicitProjectScopeRequired: true,
    allowAistroykaFallback: false,
    loadFixturesMayCreateVerifiedMemories: false,
    liveGateIsReadOnly: true,
    payloadBodiesMayBeLogged: false,
  },
} as const;

export type M20PerformanceRetrievalGatePack =
  typeof OFFICIAL_M20_PERFORMANCE_RETRIEVAL_GATE_PACK;

export const packageName = 'observability' as const;

export type LogFields = Record<string, unknown>;

export const REDACTED_LOG_VALUE = '[REDACTED]' as const;
export const OFFICIAL_M14_SLO_PACK_VERSION = 'm14-s01-v1' as const;
export const OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION = 'm14-s03-v1' as const;
export const OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION = 'm14-s04-v1' as const;
export const OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION = 'm14-s05-v1' as const;
export const OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION = 'm14-s06-v1' as const;
export const OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION = 'm14-s07-v1' as const;
export const OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION = 'm14-s08-v1' as const;
export const OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION = 'm14-s09-v1' as const;

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

type DrRestoreDrillTargetId =
  | 'db-backup-contour'
  | 'storage-backup-contour'
  | 'rls-after-restore'
  | 'checksum-verify'
  | 'embedding-index-rebuild'
  | 'provenance-sample';

type DrRestoreDrillTarget = {
  id: DrRestoreDrillTargetId;
  contour: 'database' | 'storage' | 'restore';
  description: string;
};

type DrRestoreDrillChecklistItem = {
  id: DrRestoreDrillTargetId;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_DR_RESTORE_DRILL_PACK = {
  version: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  roadmapSections: ['7.5', '20.17'],
  targets: [
    {
      id: 'db-backup-contour',
      contour: 'database',
      description:
        'Database backup contour is present and explicitly separate from Storage object archival.',
    },
    {
      id: 'storage-backup-contour',
      contour: 'storage',
      description:
        'Archived-object Storage contour is versioned, off-site, and independent from database backup restore.',
    },
    {
      id: 'rls-after-restore',
      contour: 'restore',
      description:
        'Restore drills must verify deny-first RLS behavior after recovery, not just row presence.',
    },
    {
      id: 'checksum-verify',
      contour: 'restore',
      description:
        'Restore drills must verify archived object checksums after recovery.',
    },
    {
      id: 'embedding-index-rebuild',
      contour: 'restore',
      description:
        'Restore drills must verify embedding/index rebuild coverage after recovery.',
    },
    {
      id: 'provenance-sample',
      contour: 'restore',
      description:
        'Restore drills must verify selective provenance reproducibility for sampled recovered records.',
    },
  ] satisfies readonly DrRestoreDrillTarget[],
  checklist: [
    {
      id: 'db-backup-contour',
      description:
        'Database backups stay a distinct contour: PITR may satisfy the 15-minute RPO, but they do not restore deleted Storage objects.',
      defensiveOnly: true,
      evidence: [
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'docs/adr/ADR-003-storage-modes.md',
        'apps/api/src/restoreDrill.ts',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
    {
      id: 'storage-backup-contour',
      description:
        'Archived-object copies stay versioned/off-site and independent from the database contour.',
      defensiveOnly: true,
      evidence: [
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'docs/adr/ADR-003-storage-modes.md',
        'apps/api/fixtures/dr-restore-drill/m14-s04-v1/storage-archive-manifest.json',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
    {
      id: 'rls-after-restore',
      description:
        'Restore drills must validate RLS deny paths after recovery instead of checking rows only.',
      defensiveOnly: true,
      evidence: [
        'tests/security/rls_matrix.test.ts',
        'docs/engineering/RLS_MATRIX.md',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
    {
      id: 'checksum-verify',
      description:
        'Archived object verification includes checksum validation after recovery.',
      defensiveOnly: true,
      evidence: [
        'docs/adr/ADR-003-storage-modes.md',
        'apps/api/fixtures/dr-restore-drill/m14-s04-v1/restore-report.json',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
    {
      id: 'embedding-index-rebuild',
      description:
        'Restore drills must record embedding/index rebuild status as part of recovery validation.',
      defensiveOnly: true,
      evidence: [
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'apps/api/fixtures/dr-restore-drill/m14-s04-v1/restore-report.json',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
    {
      id: 'provenance-sample',
      description:
        'Restore drills must confirm selective provenance reproducibility for sampled recovered memories.',
      defensiveOnly: true,
      evidence: [
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'apps/api/fixtures/dr-restore-drill/m14-s04-v1/owner-export-metadata.json',
        'apps/api/src/restoreDrill.test.ts',
      ],
    },
  ] satisfies readonly DrRestoreDrillChecklistItem[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    modeAToolCount: 7,
    requireIndependentDatabaseBackupContour: true,
    requireIndependentStorageArchiveContour: true,
    databaseBackupRestoresStorageObjects: false,
    maxDatabaseRpoMinutesWithPitr: 15,
    requireDocumentedDailyDatabaseRpoWithoutPitr: true,
    maxArchivedObjectRpoHours: 24,
    maxPrivateBetaRtoHours: 8,
    requireQuarterlyRestoreDrill: true,
    requirePreGaRestoreDrill: true,
    checkRowsPresent: true,
    checkRlsAfterRestore: true,
    checkObjectChecksums: true,
    checkEmbeddingIndexRebuild: true,
    checkSelectiveProvenanceReproducibility: true,
    requireExplicitProjectIdOnWriteOrExportInvocation: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRestore: false,
    allowProductionSqlApply: false,
    logMemoryBodies: false,
    logTokens: false,
  },
} as const;

type IncidentRunbookId =
  | 'alert-ownership-and-routing'
  | 'key-rotation'
  | 'emergency-revoke'
  | 'connector-revoke-stop-sync'
  | 'webhook-dlq-replay-resync'
  | 'service-role-vault-compromise';

type IncidentAlertId =
  | 'slo.api.availability'
  | 'slo.mcp.availability'
  | 'slo.project.state'
  | 'slo.search.hybrid'
  | 'slo.search.agentic'
  | 'slo.write.receipt'
  | 'slo.webhook.ack'
  | 'security.acl.leakage'
  | 'security.secrets.rotation-overdue'
  | 'security.connector-token-compromised';

type IncidentRunbookOwnerRole =
  | 'Platform on-call'
  | 'Security on-call'
  | 'Connector on-call';

type IncidentRunbookSpec = {
  id: IncidentRunbookId;
  ownerRole: IncidentRunbookOwnerRole;
  description: string;
  requiredSnippets: readonly string[];
};

type IncidentAlertSpec = {
  id: IncidentAlertId;
  ownerRole: IncidentRunbookOwnerRole;
  runbookId: IncidentRunbookId;
  metadataOnly: true;
};

type IncidentRunbookChecklistItemId =
  | 'alert-owner-routing'
  | 'key-rotation'
  | 'emergency-revoke'
  | 'connector-revoke-stop-jobs'
  | 'webhook-dlq-replay-resync'
  | 'service-role-vault-compromise'
  | 'no-payload-in-alerts';

type IncidentRunbookChecklistItem = {
  id: IncidentRunbookChecklistItemId;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_INCIDENT_RUNBOOK_PACK = {
  version: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  drRestoreDrillPackVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  roadmapSections: ['16.4', '20.17'],
  runbooks: [
    {
      id: 'alert-ownership-and-routing',
      ownerRole: 'Platform on-call',
      description:
        'Maps the current official alerts to named owners and existing rollback/revoke paths.',
      requiredSnippets: [
        'Do not paste tokens, payloads, or memory bodies into alerts, logs, or tickets.',
        'STAGING_PROMOTE.md',
        'owner approval',
      ],
    },
    {
      id: 'key-rotation',
      ownerRole: 'Security on-call',
      description:
        'Defines the bounded vault-first key rotation path and links emergency revoke.',
      requiredSnippets: ['rotation cadence', 'vault first', '## Rollback / revoke'],
    },
    {
      id: 'emergency-revoke',
      ownerRole: 'Security on-call',
      description:
        'Defines immediate containment for secret compromise before any restore or re-enable.',
      requiredSnippets: [
        'stop jobs/webhooks immediately',
        'explicit `project_id`',
        '## Rollback / revoke',
      ],
    },
    {
      id: 'connector-revoke-stop-sync',
      ownerRole: 'Connector on-call',
      description:
        'Documents connector revoke on the current API surface and requires immediate job/webhook stop plus retention.',
      requiredSnippets: [
        'POST /v1/connections/:id/revoke',
        'stop jobs/webhooks immediately',
        'apply retention',
      ],
    },
    {
      id: 'webhook-dlq-replay-resync',
      ownerRole: 'Connector on-call',
      description:
        'Documents bounded webhook DLQ, replay, reconcile, and resync recovery using the existing API surface.',
      requiredSnippets: [
        'POST /v1/jobs/:id/replay',
        'POST /v1/connections/:id/resync',
        'POST /v1/jobs/dead-letter-stale',
      ],
    },
    {
      id: 'service-role-vault-compromise',
      ownerRole: 'Security on-call',
      description:
        'Documents bounded response to compromised service_role or vault key without live production action.',
      requiredSnippets: [
        'rotate the compromised `service_role` or vault key',
        'invalidate sessions',
        'audit access logs',
      ],
    },
  ] satisfies readonly IncidentRunbookSpec[],
  alerts: [
    {
      id: 'slo.api.availability',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.mcp.availability',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.project.state',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.search.hybrid',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.search.agentic',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.write.receipt',
      ownerRole: 'Platform on-call',
      runbookId: 'alert-ownership-and-routing',
      metadataOnly: true,
    },
    {
      id: 'slo.webhook.ack',
      ownerRole: 'Connector on-call',
      runbookId: 'webhook-dlq-replay-resync',
      metadataOnly: true,
    },
    {
      id: 'security.acl.leakage',
      ownerRole: 'Security on-call',
      runbookId: 'service-role-vault-compromise',
      metadataOnly: true,
    },
    {
      id: 'security.secrets.rotation-overdue',
      ownerRole: 'Security on-call',
      runbookId: 'key-rotation',
      metadataOnly: true,
    },
    {
      id: 'security.connector-token-compromised',
      ownerRole: 'Connector on-call',
      runbookId: 'emergency-revoke',
      metadataOnly: true,
    },
  ] satisfies readonly IncidentAlertSpec[],
  checklist: [
    {
      id: 'alert-owner-routing',
      description:
        'Every current official alert maps to a checked-in runbook and a named owner on the existing stack.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/alert-ownership-and-routing.md',
        'apps/api/fixtures/incident-runbooks/m14-s05-v1/runbook-manifest.json',
        'apps/api/src/incidentRunbookDrill.test.ts',
      ],
    },
    {
      id: 'key-rotation',
      description:
        'Key rotation stays documented as a bounded vault-first runbook before beta.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/key-rotation.md',
        'docs/engineering/SECRETS_POLICY.md',
        'docs/adr/ADR-005-secrets-and-environments.md',
      ],
    },
    {
      id: 'emergency-revoke',
      description:
        'Emergency revoke stays documented as a bounded containment path that does not rely on new product surfaces.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/emergency-revoke.md',
        'docs/engineering/SECRETS_POLICY.md',
        'apps/api/src/incidentRunbookDrill.test.ts',
      ],
    },
    {
      id: 'connector-revoke-stop-jobs',
      description:
        'Connector revoke must stop jobs/webhooks immediately and only then apply retention.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/connector-revoke-stop-sync.md',
        'apps/api/src/app.ts',
        'apps/api/src/incidentRunbookDrill.test.ts',
      ],
    },
    {
      id: 'webhook-dlq-replay-resync',
      description:
        'Webhook incident recovery stays on the existing DLQ/replay/resync/reconcile surface with explicit ownership.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/webhook-dlq-replay-resync.md',
        'docs/engineering/M8_GITHUB_WEBHOOK_RECEIVER.md',
        'apps/api/src/incidentRunbookDrill.test.ts',
      ],
    },
    {
      id: 'service-role-vault-compromise',
      description:
        'Compromised service_role or vault key requires rotation, session invalidation, and audit-log review.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/service-role-vault-compromise.md',
        'docs/engineering/SECRETS_POLICY.md',
        'docs/adr/ADR-005-secrets-and-environments.md',
      ],
    },
    {
      id: 'no-payload-in-alerts',
      description:
        'Incident runbooks and alert mappings stay metadata-only and do not include tokens, payloads, or memory bodies.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/runbooks/alert-ownership-and-routing.md',
        'apps/api/src/incidentRunbookDrill.ts',
        'apps/api/src/incidentRunbookDrill.test.ts',
      ],
    },
  ] satisfies readonly IncidentRunbookChecklistItem[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    modeAToolCount: 7,
    requireRunbookOwner: true,
    requireRollbackOrRevokeStep: true,
    requireExplicitProjectIdOnAdminOrRevokeInvocation: true,
    requireAlertOwner: true,
    requireAlertRunbook: true,
    requireKeyRotationRunbook: true,
    requireEmergencyRevokeRunbook: true,
    requireConnectorRevokeStopJobsAndWebhooks: true,
    requireInvalidateSessionsAfterServiceRoleRotation: true,
    requireAuditAccessLogReview: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRevoke: false,
    allowLiveRollback: false,
    allowProductionSqlApply: false,
    logMemoryBodies: false,
    logTokens: false,
    logAlertPayloads: false,
  },
} as const;

type PrivacySlaPathId =
  | 'owner-export'
  | 'privacy-deletion'
  | 'privacy-correction'
  | 'privacy-retraction';

type PrivacySlaOwnerRole = 'Privacy owner' | 'Connector on-call';

type PrivacySlaPathSpec = {
  id: PrivacySlaPathId;
  route: 'GET /v1/export/memories' | 'POST /v1/privacy/requests';
  requestType?: 'deletion' | 'correction' | 'retraction';
  ownerRole: PrivacySlaOwnerRole;
  deadline: string;
  description: string;
  connectorDerivedCoverage: boolean;
  explicitProjectIdRequired: boolean;
  metadataOnlyAudit: true;
};

type PrivacySlaChecklistItemId =
  | 'owner-export-sla'
  | 'deletion-forget-sla'
  | 'correction-retraction-sla'
  | 'connector-derived-coverage'
  | 'no-payload-in-export-logs';

type PrivacySlaChecklistItem = {
  id: PrivacySlaChecklistItemId;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_PRIVACY_SLA_PACK = {
  version: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  drRestoreDrillPackVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  incidentRunbookPackVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  roadmapSections: ['16.6', '16.7', '20.17'],
  slaPaths: [
    {
      id: 'owner-export',
      route: 'GET /v1/export/memories',
      ownerRole: 'Privacy owner',
      deadline: '72h from validated owner request',
      description:
        'Owner export stays on the existing project-scoped GET /v1/export/memories path and covers canonical plus connector-derived memories.',
      connectorDerivedCoverage: true,
      explicitProjectIdRequired: true,
      metadataOnlyAudit: true,
    },
    {
      id: 'privacy-deletion',
      route: 'POST /v1/privacy/requests',
      requestType: 'deletion',
      ownerRole: 'Privacy owner',
      deadline: '30d from validated owner request',
      description:
        'Deletion / forget stays on the existing privacy-request path and must cover connector-derived records, tombstones, and retention handoff.',
      connectorDerivedCoverage: true,
      explicitProjectIdRequired: true,
      metadataOnlyAudit: true,
    },
    {
      id: 'privacy-correction',
      route: 'POST /v1/privacy/requests',
      requestType: 'correction',
      ownerRole: 'Privacy owner',
      deadline: '30d from validated owner request',
      description:
        'Correction requests stay on the existing privacy-request path and remain project-scoped with metadata-only audit trails.',
      connectorDerivedCoverage: false,
      explicitProjectIdRequired: true,
      metadataOnlyAudit: true,
    },
    {
      id: 'privacy-retraction',
      route: 'POST /v1/privacy/requests',
      requestType: 'retraction',
      ownerRole: 'Privacy owner',
      deadline: '30d from validated owner request',
      description:
        'Retraction requests stay on the existing privacy-request path and remain project-scoped with metadata-only audit trails.',
      connectorDerivedCoverage: false,
      explicitProjectIdRequired: true,
      metadataOnlyAudit: true,
    },
  ] satisfies readonly PrivacySlaPathSpec[],
  checklist: [
    {
      id: 'owner-export-sla',
      description:
        'The existing owner export path has a checked-in owner, deadline, explicit project scope, and no payload logging.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'apps/api/src/app.ts',
        'apps/api/src/app.test.ts',
        'apps/mcp-gateway/src/tools.ts',
        'apps/mcp-gateway/src/tools.test.ts',
      ],
    },
    {
      id: 'deletion-forget-sla',
      description:
        'The existing deletion / forget request path has a checked-in owner, deadline, explicit project scope, and metadata-only audit coverage.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'packages/domain/src/store.ts',
        'supabase/migrations/20260820065500_m14_slice_06_privacy_request_sla_guards.sql',
        'apps/api/src/app.test.ts',
      ],
    },
    {
      id: 'correction-retraction-sla',
      description:
        'Correction and retraction requests stay on the current privacy-request surface with checked-in owners, deadlines, and explicit project scope.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'apps/api/src/privacySlaDrill.ts',
        'apps/api/src/privacySlaDrill.test.ts',
      ],
    },
    {
      id: 'connector-derived-coverage',
      description:
        'Export and deletion SLAs explicitly name connector-derived coverage and reuse the shared connector tombstone surfaces instead of inventing a parallel deletion product.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'docs/m0/DATA_CLASSES_AND_RETENTION.md',
        'workers/connector-sync/src/index.ts',
        'workers/connector-sync/src/index.test.ts',
        'docs/engineering/M10_DRIVE_SLICE_02.md',
        'docs/engineering/M11_GMAIL_SLICE_01.md',
        'docs/engineering/M11_CALENDAR_SLICE_02.md',
        'apps/web/src/TransferredObjectsPage.tsx',
      ],
    },
    {
      id: 'no-payload-in-export-logs',
      description:
        'Export and privacy-request audit/log surfaces stay metadata-only and do not log memory bodies, tokens, correction text, or export payloads.',
      defensiveOnly: true,
      evidence: [
        'packages/observability/src/index.test.ts',
        'apps/api/src/app.test.ts',
        'apps/api/src/privacySlaDrill.test.ts',
        'packages/domain/src/store.ts',
        'supabase/migrations/20260820065500_m14_slice_06_privacy_request_sla_guards.sql',
      ],
    },
  ] satisfies readonly PrivacySlaChecklistItem[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    modeAToolCount: 7,
    requireSlaOwner: true,
    requireSlaDeadline: true,
    requireConnectorDerivedCoverage: true,
    requireCorrectionRetractionCoverage: true,
    requireExplicitProjectIdOnExportOrDeleteInvocation: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveExport: false,
    allowLiveDelete: false,
    allowProductionSqlApply: false,
    logMemoryBodies: false,
    logTokens: false,
    logExportPayloads: false,
    logPrivacyRequestReasons: false,
  },
} as const;

type DependencyUpgradeControlId =
  | 'upgrade-owner'
  | 'rollback-note'
  | 'contract-and-smoke-gate'
  | 'protocol-adr-and-contract-tests'
  | 'mode-a-seven-tools'
  | 'explicit-project-id-no-default-fallback'
  | 'no-secret-payload-or-verified-write-leaks';

type DependencyUpgradeOwnerRole = 'Platform owner';

type DependencyUpgradeControl = {
  id: DependencyUpgradeControlId;
  ownerRole: DependencyUpgradeOwnerRole;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK = {
  version: OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  drRestoreDrillPackVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  incidentRunbookPackVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  privacySlaPackVersion: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  roadmapSections: ['20.17'],
  controls: [
    {
      id: 'upgrade-owner',
      ownerRole: 'Platform owner',
      description:
        'Every dependency upgrade batch stays owned, versioned, and bounded to the current stack before merge.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md',
        'docs/engineering/M14_SLICE_07.md',
        'apps/api/fixtures/dependency-upgrade/m14-s07-v1/policy-manifest.json',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
    {
      id: 'rollback-note',
      ownerRole: 'Platform owner',
      description:
        'Every dependency upgrade batch carries an explicit rollback note before any merge or staging promote.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md',
        'apps/api/fixtures/dependency-upgrade/m14-s07-v1/policy-manifest.json',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
    {
      id: 'contract-and-smoke-gate',
      ownerRole: 'Platform owner',
      description:
        'Dependency changes stay gated by the current contract tests, typecheck, critical audit, and ChatGPT MCP smoke.',
      defensiveOnly: true,
      evidence: [
        '.github/workflows/ci.yml',
        'scripts/smoke-mcp-chatgpt.sh',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
    {
      id: 'protocol-adr-and-contract-tests',
      ownerRole: 'Platform owner',
      description:
        'MCP protocol and SDK changes require ADR references plus updated contract and smoke evidence instead of silent bumps.',
      defensiveOnly: true,
      evidence: [
        'docs/adr/ADR-001-canonical-memory.md',
        'docs/adr/ADR-005-secrets-and-environments.md',
        'apps/mcp-gateway/src/profile.test.ts',
        'apps/mcp-gateway/src/rpc.test.ts',
        'scripts/smoke-mcp-chatgpt.sh',
      ],
    },
    {
      id: 'mode-a-seven-tools',
      ownerRole: 'Platform owner',
      description:
        'ChatGPT Mode A stays at exactly 7 tools with no owner or operations expansion during upgrades.',
      defensiveOnly: true,
      evidence: [
        'apps/mcp-gateway/src/profile.ts',
        'apps/mcp-gateway/src/profile.test.ts',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
    {
      id: 'explicit-project-id-no-default-fallback',
      ownerRole: 'Platform owner',
      description:
        'Any write, admin, or apply path requires explicit project scope and ignores MEMORY_OS_DEFAULT_PROJECT_ID / AISTROYKA fallback.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md',
        'apps/api/src/dependencyUpgradeDrill.ts',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
    {
      id: 'no-secret-payload-or-verified-write-leaks',
      ownerRole: 'Platform owner',
      description:
        'Upgrade notes, CI output, and local validation remain metadata-only with no verified-memory writes, tokens, or memory bodies.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/SECRETS_POLICY.md',
        'packages/observability/src/index.test.ts',
        'apps/api/src/dependencyUpgradeDrill.test.ts',
      ],
    },
  ] satisfies readonly DependencyUpgradeControl[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    modeAToolCount: 7,
    requireUpgradeOwner: true,
    requireRollbackNote: true,
    requireContractTests: true,
    requireSmokeTest: true,
    requireProtocolAdrForMcpOrSdkChanges: true,
    requireProtocolContractTests: true,
    requireExplicitProjectIdOnWriteAdminOrApplyInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    allowLiveMassUpgrade: false,
    allowNewVendor: false,
    allowSilentProtocolBump: false,
    logMemoryBodies: false,
    logTokens: false,
    logUpgradePayloads: false,
    logCiSecrets: false,
  },
} as const;

type GaDocSurfaceId =
  | 'slo-error-budgets'
  | 'bounded-soak'
  | 'security-review'
  | 'dr-restore-drill'
  | 'incident-runbooks'
  | 'export-deletion-slas'
  | 'dependency-upgrade-policy'
  | 'rls-matrix'
  | 'secrets-policy'
  | 'mcp-mode-a';

type GaDocOwnerRole = 'Platform owner' | 'Security owner' | 'Privacy owner';
type GaDocStatus = 'current official';

type GaDocSurfaceSpec = {
  id: GaDocSurfaceId;
  ownerRole: GaDocOwnerRole;
  status: GaDocStatus;
  primaryDocPath: string;
  versionTag: string;
  linkedPaths: readonly string[];
  description: string;
};

export const OFFICIAL_M14_GA_DOC_CATALOG_PACK = {
  version: OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  boundedSoakRecipeVersion: 'm14-s02-v1',
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  drRestoreDrillPackVersion: OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION,
  incidentRunbookPackVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  privacySlaPackVersion: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  dependencyUpgradePolicyPackVersion:
    OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
  roadmapSections: ['20.17'],
  surfaces: [
    {
      id: 'slo-error-budgets',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/M14_SLICE_01.md',
      versionTag: 'm14-s01-v1',
      linkedPaths: ['packages/observability/src/index.ts'],
      description:
        'Current official SLO pack and bounded telemetry targets stay linked and versioned.',
    },
    {
      id: 'bounded-soak',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/M14_SLICE_02.md',
      versionTag: 'm14-s02-v1',
      linkedPaths: ['apps/api/src/soakHarness.ts'],
      description:
        'Current official bounded soak recipe stays linked without adding a new ops surface.',
    },
    {
      id: 'security-review',
      ownerRole: 'Security owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/M14_SLICE_03.md',
      versionTag: 'm14-s03-v1',
      linkedPaths: [
        'docs/engineering/RLS_MATRIX.md',
        'tests/security/rls_matrix.test.ts',
      ],
      description:
        'Current official security review pack stays linked to negative coverage and RLS evidence.',
    },
    {
      id: 'dr-restore-drill',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/M14_SLICE_04.md',
      versionTag: 'm14-s04-v1',
      linkedPaths: ['apps/api/src/restoreDrill.ts'],
      description:
        'Current official DR restore drill stays linked as a bounded fixture-only surface.',
    },
    {
      id: 'incident-runbooks',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/M14_SLICE_05.md',
      versionTag: 'm14-s05-v1',
      linkedPaths: [
        'docs/engineering/runbooks/alert-ownership-and-routing.md',
        'docs/engineering/runbooks/',
      ],
      description:
        'Current official incident runbooks stay linked on the existing stack with checked-in ownership.',
    },
    {
      id: 'export-deletion-slas',
      ownerRole: 'Privacy owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
      versionTag: 'm14-s06-v1',
      linkedPaths: ['docs/engineering/M14_SLICE_06.md'],
      description:
        'Current official export and deletion SLA notes stay linked without inventing a parallel privacy product.',
    },
    {
      id: 'dependency-upgrade-policy',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/DEPENDENCY_UPGRADE_POLICY.md',
      versionTag: 'm14-s07-v1',
      linkedPaths: ['docs/engineering/M14_SLICE_07.md'],
      description:
        'Current official dependency-upgrade policy stays linked as a bounded local-only control surface.',
    },
    {
      id: 'rls-matrix',
      ownerRole: 'Security owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/RLS_MATRIX.md',
      versionTag: 'm14-s08-v1',
      linkedPaths: ['tests/security/rls_matrix.test.ts'],
      description:
        'Current official RLS matrix stays linked and catalogued by the versioned GA doc pack.',
    },
    {
      id: 'secrets-policy',
      ownerRole: 'Security owner',
      status: 'current official',
      primaryDocPath: 'docs/engineering/SECRETS_POLICY.md',
      versionTag: 'm14-s08-v1',
      linkedPaths: ['docs/adr/ADR-005-secrets-and-environments.md'],
      description:
        'Current official secrets policy stays linked and catalogued by the versioned GA doc pack.',
    },
    {
      id: 'mcp-mode-a',
      ownerRole: 'Platform owner',
      status: 'current official',
      primaryDocPath: 'docs/m0/CHATGPT_MCP_PLAN.md',
      versionTag: 'm14-s08-v1',
      linkedPaths: [
        'docs/engineering/MCP_CURSOR.md',
        'scripts/smoke-mcp-chatgpt.sh',
      ],
      description:
        'Current official ChatGPT Mode A contract stays linked at exactly 7 tools with no owner or ops widening.',
    },
  ] satisfies readonly GaDocSurfaceSpec[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    requireCatalogIndex: true,
    requireDocOwner: true,
    requireDocStatus: true,
    failClosedWhenDocMissing: true,
    failClosedWhenCatalogLeaksTokens: true,
    failClosedWhenCatalogLeaksPayloads: true,
    modeAToolCount: 7,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    logMemoryBodies: false,
    logTokens: false,
    allowCatalogPayloadExamples: false,
  },
} as const;

type FirstHourOnboardingStepId =
  | 'connect-chatgpt-mode-a'
  | 'connect-cursor-mcp'
  | 'open-control-center'
  | 'pick-explicit-project'
  | 'capture-one-memory'
  | 'search-read-after-write'
  | 'find-export-privacy-runbooks';

type FirstHourOnboardingSurface =
  | 'chatgpt'
  | 'cursor'
  | 'control-center'
  | 'privacy';

type FirstHourOnboardingOwnerRole = 'Platform owner' | 'Privacy owner';

type FirstHourOnboardingStep = {
  id: FirstHourOnboardingStepId;
  ownerRole: FirstHourOnboardingOwnerRole;
  surface: FirstHourOnboardingSurface;
  description: string;
  requiredArtifacts: readonly string[];
};

type FirstHourOnboardingChecklistItemId =
  | 'mode-a-seven-tools'
  | 'cursor-mcp-current-surface'
  | 'control-center-explicit-project'
  | 'candidate-capture-only'
  | 'search-read-after-write'
  | 'privacy-and-runbooks-findable'
  | 'no-secret-payload-or-fallback-leak';

type FirstHourOnboardingChecklistItem = {
  id: FirstHourOnboardingChecklistItemId;
  description: string;
  defensiveOnly: true;
  evidence: readonly string[];
};

export const OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK = {
  version: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  securityReviewPackVersion: OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION,
  privacySlaPackVersion: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  dependencyUpgradePolicyPackVersion:
    OFFICIAL_M14_DEPENDENCY_UPGRADE_POLICY_PACK_VERSION,
  gaDocCatalogPackVersion: OFFICIAL_M14_GA_DOC_CATALOG_PACK_VERSION,
  roadmapSections: ['20.17'],
  steps: [
    {
      id: 'connect-chatgpt-mode-a',
      ownerRole: 'Platform owner',
      surface: 'chatgpt',
      description:
        'Connect ChatGPT to the current official Mode A profile and confirm the exposed surface stays at exactly 7 tools.',
      requiredArtifacts: [
        'docs/m0/CHATGPT_MCP_PLAN.md',
        'docs/engineering/M6_CHATGPT_PRODUCTION.md',
        'apps/mcp-gateway/src/profile.ts',
      ],
    },
    {
      id: 'connect-cursor-mcp',
      ownerRole: 'Platform owner',
      surface: 'cursor',
      description:
        'Connect Cursor to the current MCP gateway surface and reuse the checked-in mcp.json / stdio guidance instead of inventing a new onboarding path.',
      requiredArtifacts: [
        'docs/engineering/MCP_CURSOR.md',
        'apps/mcp-gateway/src/tools.ts',
      ],
    },
    {
      id: 'open-control-center',
      ownerRole: 'Platform owner',
      surface: 'control-center',
      description:
        'Open the current Control Center and reuse the existing home, connections, projects, search, and privacy pages.',
      requiredArtifacts: [
        'apps/web/src/App.tsx',
        'apps/web/src/ConnectionsPage.tsx',
        'apps/web/src/ProjectsPage.tsx',
        'apps/web/src/PrivacyPage.tsx',
      ],
    },
    {
      id: 'pick-explicit-project',
      ownerRole: 'Platform owner',
      surface: 'control-center',
      description:
        'Pick an explicit project before any write, admin, or export path; never rely on MEMORY_OS_DEFAULT_PROJECT_ID or AISTROYKA fallback.',
      requiredArtifacts: [
        'apps/web/src/projectScope.ts',
        'apps/api/src/app.ts',
        'apps/mcp-gateway/src/tools.ts',
      ],
    },
    {
      id: 'capture-one-memory',
      ownerRole: 'Platform owner',
      surface: 'chatgpt',
      description:
        'Capture one candidate memory through the current MCP capture path without creating a verified memory as part of onboarding.',
      requiredArtifacts: [
        'apps/mcp-gateway/src/tools.ts',
        'apps/api/src/app.ts',
      ],
    },
    {
      id: 'search-read-after-write',
      ownerRole: 'Platform owner',
      surface: 'control-center',
      description:
        'Use the current search and project-context surfaces for read-after-write without widening scope or requiring a new onboarding UI.',
      requiredArtifacts: [
        'apps/web/src/SearchPage.tsx',
        'apps/web/src/App.tsx',
        'apps/mcp-gateway/src/tools.ts',
      ],
    },
    {
      id: 'find-export-privacy-runbooks',
      ownerRole: 'Privacy owner',
      surface: 'privacy',
      description:
        'Point owners to the existing privacy/export page and checked-in runbooks instead of adding a new support or operations workflow.',
      requiredArtifacts: [
        'apps/web/src/PrivacyPage.tsx',
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'docs/engineering/runbooks/',
      ],
    },
  ] satisfies readonly FirstHourOnboardingStep[],
  checklist: [
    {
      id: 'mode-a-seven-tools',
      description:
        'ChatGPT Mode A remains the official seven-tool surface and onboarding does not widen it.',
      defensiveOnly: true,
      evidence: [
        'apps/mcp-gateway/src/profile.ts',
        'apps/mcp-gateway/src/profile.test.ts',
        'docs/m0/CHATGPT_MCP_PLAN.md',
      ],
    },
    {
      id: 'cursor-mcp-current-surface',
      description:
        'Cursor onboarding reuses the checked-in MCP gateway guide and current tool surface.',
      defensiveOnly: true,
      evidence: [
        'docs/engineering/MCP_CURSOR.md',
        'apps/mcp-gateway/src/tools.ts',
      ],
    },
    {
      id: 'control-center-explicit-project',
      description:
        'Control Center onboarding requires an explicit project selection and never defaults to AISTROYKA.',
      defensiveOnly: true,
      evidence: [
        'apps/web/src/projectScope.ts',
        'apps/web/src/ProjectsPage.tsx',
        'apps/api/src/app.test.ts',
      ],
    },
    {
      id: 'candidate-capture-only',
      description:
        'The first captured onboarding memory uses candidate capture only; onboarding does not instruct verified writes or owner-token bypass.',
      defensiveOnly: true,
      evidence: [
        'apps/mcp-gateway/src/tools.ts',
        'apps/mcp-gateway/src/tools.test.ts',
        'docs/engineering/ONBOARDING.md',
      ],
    },
    {
      id: 'search-read-after-write',
      description:
        'Owners can search and inspect the captured memory on the current MCP and Control Center surfaces after write.',
      defensiveOnly: true,
      evidence: [
        'apps/web/src/SearchPage.tsx',
        'apps/mcp-gateway/src/tools.ts',
        'docs/engineering/ONBOARDING.md',
      ],
    },
    {
      id: 'privacy-and-runbooks-findable',
      description:
        'The first-hour guide links the current privacy/export and runbook surfaces without inventing a new support flow.',
      defensiveOnly: true,
      evidence: [
        'apps/web/src/PrivacyPage.tsx',
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'docs/engineering/runbooks/',
      ],
    },
    {
      id: 'no-secret-payload-or-fallback-leak',
      description:
        'The onboarding pack, guide, and local drill remain metadata-only: no tokens, no payload bodies, no verified writes, and no AISTROYKA fallback.',
      defensiveOnly: true,
      evidence: [
        'packages/observability/src/index.test.ts',
        'apps/api/src/firstHourOnboardingDrill.test.ts',
        'tests/security/m14_slice_09_pack.test.ts',
      ],
    },
  ] satisfies readonly FirstHourOnboardingChecklistItem[],
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    modeAToolCount: 7,
    requireStepOwner: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowProductionSqlApply: false,
    allowLiveOnboarding: false,
    allowNewUi: false,
    allowNewVendor: false,
    logMemoryBodies: false,
    logTokens: false,
    logPayloadBodies: false,
  },
} as const;

export const OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION = 'm14-s10-v1' as const;

type SupportOpsOwnerRole =
  | 'Platform on-call'
  | 'Security on-call'
  | 'Connector on-call'
  | 'Privacy owner';

type SupportOpsLinkId =
  | 'ops-route'
  | 'slo-pack'
  | 'alert-routing-runbook'
  | 'emergency-revoke-runbook'
  | 'connector-revoke-runbook'
  | 'privacy-route'
  | 'privacy-sla-doc'
  | 'audit-route'
  | 'connections-route'
  | 'onboarding-guide';

type SupportOpsLinkKind = 'route' | 'doc';

type SupportOpsLinkSpec = {
  id: SupportOpsLinkId;
  label: string;
  kind: SupportOpsLinkKind;
  target: string;
  ownerRole: SupportOpsOwnerRole;
  description: string;
  metadataOnly: true;
  explicitProjectIdRequired: boolean;
};

type SupportOpsOwnershipAreaId =
  | 'slo-and-error-budgets'
  | 'revoke-and-rollback'
  | 'export-and-privacy'
  | 'on-call-routing';

type SupportOpsOwnershipArea = {
  id: SupportOpsOwnershipAreaId;
  ownerRole: SupportOpsOwnerRole;
  primaryLinkId: SupportOpsLinkId;
  description: string;
};

export const OFFICIAL_M14_SUPPORT_OPS_PACK = {
  version: OFFICIAL_M14_SUPPORT_OPS_PACK_VERSION,
  sloPackVersion: OFFICIAL_M14_SLO_PACK_VERSION,
  incidentRunbookPackVersion: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
  privacySlaPackVersion: OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
  firstHourOnboardingPackVersion: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK_VERSION,
  roadmapSections: ['20.17', 'RG5 support+ownership'],
  entryRoute: '/ops',
  supportLinks: [
    {
      id: 'ops-route',
      label: 'Control Center /ops',
      kind: 'route',
      target: '/ops',
      ownerRole: 'Platform on-call',
      description:
        'Official bounded support surface on the existing Control Center /ops page.',
      metadataOnly: true,
      explicitProjectIdRequired: false,
    },
    {
      id: 'slo-pack',
      label: 'SLO + error budgets',
      kind: 'doc',
      target: 'docs/engineering/M14_SLICE_01.md',
      ownerRole: 'Platform on-call',
      description:
        'Current official SLO pack, error-budget targets, and bounded telemetry contract.',
      metadataOnly: true,
      explicitProjectIdRequired: false,
    },
    {
      id: 'alert-routing-runbook',
      label: 'Alert ownership + routing',
      kind: 'doc',
      target: 'docs/engineering/runbooks/alert-ownership-and-routing.md',
      ownerRole: 'Platform on-call',
      description:
        'Maps official alerts to named owners and existing rollback / revoke references.',
      metadataOnly: true,
      explicitProjectIdRequired: false,
    },
    {
      id: 'emergency-revoke-runbook',
      label: 'Emergency revoke',
      kind: 'doc',
      target: 'docs/engineering/runbooks/emergency-revoke.md',
      ownerRole: 'Security on-call',
      description:
        'Security containment path for revoke / rollback scenarios without live ops action.',
      metadataOnly: true,
      explicitProjectIdRequired: true,
    },
    {
      id: 'connector-revoke-runbook',
      label: 'Connector revoke + stop sync',
      kind: 'doc',
      target: 'docs/engineering/runbooks/connector-revoke-stop-sync.md',
      ownerRole: 'Connector on-call',
      description:
        'Connector on-call revoke path with job / webhook stop requirements and retention handoff.',
      metadataOnly: true,
      explicitProjectIdRequired: true,
    },
    {
      id: 'privacy-route',
      label: 'Privacy page',
      kind: 'route',
      target: '/privacy',
      ownerRole: 'Privacy owner',
      description:
        'Existing export and privacy request surface; no payload preview on /ops.',
      metadataOnly: true,
      explicitProjectIdRequired: true,
    },
    {
      id: 'privacy-sla-doc',
      label: 'Export + privacy SLAs',
      kind: 'doc',
      target: 'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
      ownerRole: 'Privacy owner',
      description:
        'Checked-in SLA, ownership, and connector-derived coverage for export and privacy requests.',
      metadataOnly: true,
      explicitProjectIdRequired: true,
    },
    {
      id: 'audit-route',
      label: 'Audit log',
      kind: 'route',
      target: '/audit',
      ownerRole: 'Security on-call',
      description:
        'Existing audit surface for metadata-only inspection; not a payload browser.',
      metadataOnly: true,
      explicitProjectIdRequired: false,
    },
    {
      id: 'connections-route',
      label: 'Connections',
      kind: 'route',
      target: '/connections',
      ownerRole: 'Connector on-call',
      description:
        'Existing connections surface for health, reauth, and bounded connector ownership.',
      metadataOnly: true,
      explicitProjectIdRequired: true,
    },
    {
      id: 'onboarding-guide',
      label: 'First-hour onboarding',
      kind: 'doc',
      target: 'docs/engineering/ONBOARDING.md',
      ownerRole: 'Platform on-call',
      description:
        'Current official first-hour guide for finding support, privacy, and runbook surfaces.',
      metadataOnly: true,
      explicitProjectIdRequired: false,
    },
  ] satisfies readonly SupportOpsLinkSpec[],
  ownership: [
    {
      id: 'slo-and-error-budgets',
      ownerRole: 'Platform on-call',
      primaryLinkId: 'slo-pack',
      description: 'Platform on-call owns the current SLO pack and error-budget review path.',
    },
    {
      id: 'revoke-and-rollback',
      ownerRole: 'Security on-call',
      primaryLinkId: 'emergency-revoke-runbook',
      description:
        'Security on-call owns emergency revoke / rollback pointers and must stay metadata-only on /ops.',
    },
    {
      id: 'export-and-privacy',
      ownerRole: 'Privacy owner',
      primaryLinkId: 'privacy-sla-doc',
      description:
        'Privacy owner owns export and privacy request SLAs plus the existing /privacy page.',
    },
    {
      id: 'on-call-routing',
      ownerRole: 'Connector on-call',
      primaryLinkId: 'connector-revoke-runbook',
      description:
        'Connector on-call owns reauth, revoke, stop-sync, and connector incident routing.',
    },
  ] satisfies readonly SupportOpsOwnershipArea[],
  summary: {
    sloTargetCount: OFFICIAL_M14_SLO_PACK.targets.length,
    incidentRunbookCount: OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.length,
    modeAToolCount: OFFICIAL_M14_FIRST_HOUR_ONBOARDING_PACK.invariants.modeAToolCount,
  },
  invariants: {
    defensiveOnly: true,
    fixtureOnly: true,
    reuseExistingOpsPage: true,
    actorSwitchingDemoOnly: true,
    requireExplicitProjectIdOnWriteAdminOrExportInvocation: true,
    ignoreDefaultProjectIdEnv: true,
    modeAToolCount: 7,
    allowOwnerTokenBypass: false,
    allowAistroykaFallback: false,
    allowVerifiedWrites: false,
    allowLiveRevoke: false,
    allowLiveRollback: false,
    allowProductionSqlApply: false,
    allowParallelOpsApp: false,
    allowNewPagerProduct: false,
    allowNewVendor: false,
    logMemoryBodies: false,
    logTokens: false,
    logPayloadBodies: false,
    logExportPayloads: false,
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

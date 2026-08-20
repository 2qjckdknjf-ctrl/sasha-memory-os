export const packageName = 'observability' as const;

export type LogFields = Record<string, unknown>;

export const REDACTED_LOG_VALUE = '[REDACTED]' as const;
export const OFFICIAL_M14_SLO_PACK_VERSION = 'm14-s01-v1' as const;
export const OFFICIAL_M14_SECURITY_REVIEW_PACK_VERSION = 'm14-s03-v1' as const;
export const OFFICIAL_M14_DR_RESTORE_DRILL_PACK_VERSION = 'm14-s04-v1' as const;
export const OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION = 'm14-s05-v1' as const;
export const OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION = 'm14-s06-v1' as const;

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

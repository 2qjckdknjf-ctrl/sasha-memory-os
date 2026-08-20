import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_INCIDENT_RUNBOOK_PACK,
  OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 05 incident runbook pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK_VERSION).toBe('m14-s05-v1');
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.version).toBe('m14-s05-v1');
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.drRestoreDrillPackVersion).toBe(
      'm14-s04-v1',
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.roadmapSections).toEqual([
      '16.4',
      '20.17',
    ]);
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants).toMatchObject({
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official alert and runbook coverage', () => {
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.runbooks.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'alert-ownership-and-routing',
        'key-rotation',
        'emergency-revoke',
        'connector-revoke-stop-sync',
        'webhook-dlq-replay-resync',
        'service-role-vault-compromise',
      ]),
    );
    expect(OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.alerts.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'slo.api.availability',
        'slo.mcp.availability',
        'slo.project.state',
        'slo.search.hybrid',
        'slo.search.agentic',
        'slo.write.receipt',
        'slo.webhook.ack',
        'security.acl.leakage',
        'security.secrets.rotation-overdue',
        'security.connector-token-compromised',
      ]),
    );
    expect(
      OFFICIAL_M14_INCIDENT_RUNBOOK_PACK.checklist.find(
        (item) => item.id === 'service-role-vault-compromise',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        'docs/engineering/runbooks/service-role-vault-compromise.md',
        'docs/engineering/SECRETS_POLICY.md',
        'docs/adr/ADR-005-secrets-and-environments.md',
      ]),
    );
  });

  it('documents bounded scope and non-production exclusions', () => {
    const doc = readFileSync(
      resolve(root, 'docs/engineering/M14_SLICE_05.md'),
      'utf8',
    );
    expect(doc).toContain('Official pack version: `m14-s05-v1`');
    expect(doc).toContain('Roadmap sections: `16.4`, `20.17`');
    expect(doc).toMatch(/## In scope/);
    expect(doc).toMatch(/## Out of scope/);
    expect(doc).toMatch(/every required runbook names an owner/i);
    expect(doc).toMatch(/every mapped alert names an owner and a runbook/i);
    expect(doc).toMatch(/rollback\/revoke step/i);
    expect(doc).toMatch(/connector revoke must stop jobs\/webhooks immediately, then apply retention/i);
    expect(doc).toMatch(
      /compromised `service_role` or vault key must rotate, invalidate sessions,[\s\S]*audit access logs/i,
    );
    expect(doc).toMatch(/explicit `project_id`/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/no owner-token bypass/i);
    expect(doc).toMatch(/no verified-memory writes/i);
    expect(doc).toMatch(/No SQL migration is required/i);
    expect(doc).toMatch(/No production SQL apply/i);
    expect(doc).toMatch(/No live production revoke or rollback/i);
    expect(doc).toMatch(/requires owner approval/i);
  });
});

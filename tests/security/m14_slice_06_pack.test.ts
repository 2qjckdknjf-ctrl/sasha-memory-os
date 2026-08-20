import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M14_PRIVACY_SLA_PACK,
  OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION,
} from '@memory-os/observability';

const root = resolve(import.meta.dirname, '../..');

describe('M14 Slice 06 privacy SLA pack', () => {
  it('publishes the official pack as versioned and defensive only', () => {
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK_VERSION).toBe('m14-s06-v1');
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.version).toBe('m14-s06-v1');
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.sloPackVersion).toBe('m14-s01-v1');
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.securityReviewPackVersion).toBe(
      'm14-s03-v1',
    );
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.drRestoreDrillPackVersion).toBe(
      'm14-s04-v1',
    );
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.incidentRunbookPackVersion).toBe(
      'm14-s05-v1',
    );
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.roadmapSections).toEqual([
      '16.6',
      '16.7',
      '20.17',
    ]);
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.invariants).toMatchObject({
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
    });
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(
      OFFICIAL_M14_PRIVACY_SLA_PACK.invariants.modeAToolCount,
    );
  });

  it('tracks the expected official privacy/export SLA coverage', () => {
    expect(OFFICIAL_M14_PRIVACY_SLA_PACK.slaPaths.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'owner-export',
        'privacy-deletion',
        'privacy-correction',
        'privacy-retraction',
      ]),
    );
    expect(
      OFFICIAL_M14_PRIVACY_SLA_PACK.checklist.find(
        (item) => item.id === 'connector-derived-coverage',
      )?.evidence,
    ).toEqual(
      expect.arrayContaining([
        'docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
        'workers/connector-sync/src/index.ts',
        'apps/web/src/TransferredObjectsPage.tsx',
      ]),
    );
  });

  it('documents bounded scope and non-production exclusions', () => {
    const doc = readFileSync(resolve(root, 'docs/engineering/M14_SLICE_06.md'), 'utf8');
    const notes = readFileSync(
      resolve(root, 'docs/engineering/privacy/EXPORT_DELETION_SLAS.md'),
      'utf8',
    );
    expect(doc).toContain('Official pack version: `m14-s06-v1`');
    expect(doc).toContain('Roadmap sections: `16.6`, `16.7`, `20.17`');
    expect(doc).toMatch(/## In scope/);
    expect(doc).toMatch(/## Out of scope/);
    expect(doc).toMatch(/every SLA path names an owner/i);
    expect(doc).toMatch(/every SLA path names a deadline/i);
    expect(doc).toMatch(/explicit `project_id`/i);
    expect(doc).toMatch(/connector-derived coverage is named explicitly/i);
    expect(doc).toMatch(/exactly 7 tools/i);
    expect(doc).toMatch(/no owner-token bypass/i);
    expect(doc).toMatch(/no verified-memory writes/i);
    expect(doc).toMatch(/No production SQL apply/i);
    expect(doc).toMatch(/No live production export or delete/i);
    expect(doc).toMatch(/requires owner approval/i);
    expect(notes).toMatch(/GET \/v1\/export\/memories/);
    expect(notes).toMatch(/POST \/v1\/privacy\/requests/);
    expect(notes).toMatch(/metadata-only audit/i);
    expect(notes).toMatch(/connector-derived/i);
    expect(notes).toMatch(/GitHub, Google Drive, Gmail, Google Calendar, and Apple transferred objects/i);
    expect(notes).toMatch(/Do not log memory bodies, export payloads, privacy request free-text reasons, correction text, or tokens\./);
  });
});

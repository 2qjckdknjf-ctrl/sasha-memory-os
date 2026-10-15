import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M18_CHATGPT_WRITEBACK_PACK } from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M18.4 ChatGPT automatic writeback pack', () => {
  it('publishes the approved-only seven-tool policy contract', () => {
    expect(OFFICIAL_M18_CHATGPT_WRITEBACK_PACK).toMatchObject({
      version: 'm18-s04-v1',
      invariants: {
        modeAToolCount: 7,
        existingStoreDecisionToolOnly: true,
        explicitProjectRequired: true,
        canonicalChatgptSubjectRequired: true,
        approvedOnly: true,
        readBeforeWriteRequired: true,
        deterministicDedupeRequired: true,
        provenanceRequired: true,
        conflictRequiresReview: true,
        readAfterWriteRequired: true,
        manualStoreDecisionCompatible: true,
      },
    });
  });

  it('wires the database policy, both MCP transports, SQL acceptance, and docs', () => {
    const migration = readFileSync(
      resolve(
        root,
        'supabase/migrations/20261015190000_m18_chatgpt_automatic_writeback.sql',
      ),
      'utf8',
    );
    const edgeContract = readFileSync(
      resolve(root, 'supabase/functions/memory-mcp/contract.ts'),
      'utf8',
    );
    const edgeHandler = readFileSync(
      resolve(root, 'supabase/functions/memory-mcp/index.ts'),
      'utf8',
    );
    const gateway = readFileSync(
      resolve(root, 'packages/db/src/gateway.ts'),
      'utf8',
    );
    const localHandler = readFileSync(
      resolve(root, 'apps/mcp-gateway/src/tools.ts'),
      'utf8',
    );
    const ephemeral = readFileSync(
      resolve(root, 'scripts/ci-ephemeral-shared-memory-smoke.sh'),
      'utf8',
    );
    const docs = readFileSync(
      resolve(root, 'docs/engineering/M18_SLICE_04.md'),
      'utf8',
    );
    const current = JSON.parse(
      readFileSync(resolve(root, 'docs/engineering/CURRENT_STATE.json'), 'utf8'),
    );

    expect(migration).toContain('api_chatgpt_writeback_decision');
    expect(migration).toContain('pg_advisory_xact_lock');
    expect(migration).toContain("'chatgpt.writeback.review_required'");
    expect(migration).toContain('api_get_memory');
    expect(edgeContract).toContain('evidence_refs');
    expect(edgeHandler).toContain('api_chatgpt_writeback_decision');
    expect(gateway).toContain('chatgptWritebackDecision');
    expect(localHandler).toContain('gateway.chatgptWritebackDecision');
    expect(ephemeral).toContain('m18_slice_04_chatgpt_writeback_cases.sql');
    expect(docs).toContain('ChatGPT Mode A remains exactly seven tools');
    expect(current).toMatchObject({
      completedThrough: 'M18.3',
      nextSlice: 'M18.4_CHATGPT_AUTOMATIC_WRITEBACK_POLICY',
      officialPacks: { m18ChatgptWriteback: 'm18-s04-v1' },
      chatgptModeA: { toolCount: 7 },
      supabase: {
        latestMigration: '20261015190000_m18_chatgpt_automatic_writeback.sql',
        migrationCount: 75,
      },
    });
  });
});

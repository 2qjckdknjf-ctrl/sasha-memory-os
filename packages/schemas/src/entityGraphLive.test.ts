import { describe, expect, it } from 'vitest';
import {
  graphRetrieveRequestSchema,
  OFFICIAL_M17_LIVE_GRAPH_PACK,
} from './entityGraphLive.js';

describe('M17.5 live graph contract', () => {
  it('accepts one explicit project and bounded traversal settings', () => {
    expect(
      graphRetrieveRequestSchema.parse({
        project_id: '44444444-4444-4444-8444-444444444402',
        seed_entity_ids: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeee41'],
        max_hops: 2,
        max_nodes: 24,
        max_edges: 48,
        min_confidence: 0.7,
      }),
    ).toMatchObject({ max_hops: 2, max_nodes: 24, max_edges: 48 });
  });

  it('rejects missing scope and traversal budgets above the canonical maximum', () => {
    expect(
      graphRetrieveRequestSchema.safeParse({
        seed_entity_ids: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeee41'],
      }).success,
    ).toBe(false);
    expect(
      graphRetrieveRequestSchema.safeParse({
        project_id: '44444444-4444-4444-8444-444444444402',
        seed_entity_ids: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeee41'],
        max_hops: 3,
      }).success,
    ).toBe(false);
  });

  it('keeps the live gate evidence-backed and server-only', () => {
    expect(OFFICIAL_M17_LIVE_GRAPH_PACK.invariants).toMatchObject({
      explicitProjectRequired: true,
      evidenceRequired: true,
      directBrowserTableAccessAllowed: false,
      crossProjectTraversalAllowed: false,
      useDefaultProjectFallback: false,
      claimLivePassFromMocks: false,
    });
  });
});

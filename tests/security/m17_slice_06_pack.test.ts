import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK } from '@memory-os/schemas';

const edgeContract = readFileSync(
  fileURLToPath(
    new URL('../../supabase/functions/memory-mcp/contract.ts', import.meta.url),
  ),
  'utf8',
);

describe('M17.6 graph/hybrid fusion security pack', () => {
  it('keeps fusion explicit, evidence-bearing and project-scoped', () => {
    expect(OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK.version).toBe('m17-s06-v1');
    expect(OFFICIAL_M17_GRAPH_HYBRID_FUSION_PACK.invariants).toMatchObject({
      explicitGraphModeRequired: true,
      explicitProjectRequired: true,
      graphAssertionsRequireEvidence: true,
      aclFilteredGraphRpcRequired: true,
      noDefaultProjectFallback: true,
      modeAToolCount: 7,
    });
  });

  it('extends memory.search without adding an eighth MCP action', () => {
    expect(edgeContract).toContain('enum: ["hybrid", "graph"]');
    expect(edgeContract.match(/name: "/g)).toHaveLength(7);
  });
});

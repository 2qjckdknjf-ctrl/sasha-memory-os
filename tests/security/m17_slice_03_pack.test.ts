import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHATGPT_PILOT_TOOLS } from '@memory-os/mcp-gateway';
import {
  OFFICIAL_M17_GRAPH_RETRIEVAL_PACK,
  OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');

describe('M17 Slice 03 graph-aware retrieval pack', () => {
  it('publishes bounded graph retrieval without live E2E PASS', () => {
    expect(OFFICIAL_M17_GRAPH_RETRIEVAL_PACK_VERSION).toBe('m17-s03-v1');
    expect(
      OFFICIAL_M17_GRAPH_RETRIEVAL_PACK.invariants.claimLiveGraphRetrievalE2EPassFromMocks,
    ).toBe(false);
    expect(OFFICIAL_M17_GRAPH_RETRIEVAL_PACK.invariants.neverUnboundedTraversal).toBe(
      true,
    );
    expect(CHATGPT_PILOT_TOOLS).toHaveLength(7);
  });

  it('keeps docs and golden fixture anchors checked in', () => {
    const sliceDoc = readFileSync(
      resolve(root, 'docs/engineering/M17_SLICE_03.md'),
      'utf8',
    );
    const docsReadme = readFileSync(resolve(root, 'docs/README.md'), 'utf8');
    expect(sliceDoc).toContain('Official pack version: `m17-s03-v1`');
    expect(sliceDoc).toMatch(/bounded/i);
    expect(docsReadme).toContain('engineering/M17_SLICE_03.md');
    expect(
      existsSync(
        resolve(
          root,
          'apps/api/fixtures/entity-graph/m17-s03-v1/golden-graph-traversal-cases.json',
        ),
      ),
    ).toBe(true);
  });
});

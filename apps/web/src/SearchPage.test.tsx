import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SearchPage } from './SearchPage';

describe('SearchPage graph/hybrid evidence surface', () => {
  it('shows the fused traversal trace and per-hit evidence', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SearchPage
          scopeLabel="проекту Sasha Memory OS"
          scopePanel={<div>scope panel</div>}
          search="Slice 01"
          packContext={false}
          searchContext={null}
          retrievalMode="graph"
          graphAvailable
          graphTrace={{
            enabled: true,
            reason: 'hybrid hits provide seeds for bounded graph traversal',
            packVersion: 'm17-s06-v1',
            trace: {
              visitedNodeCount: 4,
              traversedEdgeCount: 3,
              stoppedReason: 'complete',
              evidenceRequired: true,
              packVersion: 'm17-s05-v1',
            },
            evidenceRefs: ['memory:receipt-1'],
          }}
          hits={[
            {
              memory: {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81',
                title: 'Slice 01 kickoff',
                content: 'Evidence-backed decision',
                status: 'verified',
              },
              score: 0.95,
              graphScore: 1,
              evidenceRefs: ['memory:receipt-1'],
            },
          ]}
          onSearchTermChange={vi.fn()}
          onPackContextChange={vi.fn()}
          onRetrievalModeChange={vi.fn()}
          onSearch={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('Graph + Hybrid (evidence-aware)');
    expect(html).toContain('graph fused');
    expect(html).toContain('4 nodes · 3 edges · complete');
    expect(html).toContain('memory:receipt-1');
    expect(html).toContain('graph 1.0000');
  });
});

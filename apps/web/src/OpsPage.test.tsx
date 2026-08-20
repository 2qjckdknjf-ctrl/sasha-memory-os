import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OpsPage } from './OpsPage';

function renderOpsPage() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OpsPage
        actor="owner"
        backend="supabase"
        scopePanel={<div>scope</div>}
        writeProjectName="Project B"
        search="ops"
        packContext
        searchContext={{
          text: 'family travel top-secret-token should never render on /ops',
          packedCount: 2,
          truncated: true,
        }}
        hits={[
          {
            memory: {
              id: 'memory-1',
              title: 'Incident summary',
              content: 'memory body should never be logged or rendered here',
              status: 'candidate',
            },
            reason: 'hybrid',
            score: 0.91,
          },
        ]}
        captureTitle="Meeting note"
        captureText="safe demo placeholder"
        lastCapture="capture-secret-should-never-render-998877"
        docTitle="Ops doc"
        docFileName="ops.txt"
        linkUrl="https://example.com"
        linkTitle="Example"
        reviewQueue={[
          {
            id: 'review-1',
            title: 'Candidate review',
            content: 'export payload body should stay out of the ops surface',
            status: 'candidate',
          },
        ]}
        outboxPending={[
          {
            id: 'outbox-1',
            eventType: 'memory.captured',
            createdAt: '2026-08-20T00:00:00.000Z',
            attempts: 1,
          },
        ]}
        jobLookupId="job-1"
        jobLookup={{
          status: 'running',
          token: 'live-secret-token',
          payload: {
            body: 'sensitive export payload body',
          },
        }}
        extractionPreview="preview-secret-should-never-render-112233"
        extractionCandidates={[
          {
            title: 'Candidate one',
            content: 'connector payload text should not show here',
            memoryType: 'fact',
            confidence: 0.7,
          },
        ]}
        extractionSelected={new Set([0])}
        connections={[
          {
            id: 'conn-1',
            connectorId: 'github',
            displayName: 'GitHub',
            status: 'reauth_required',
            lastError: 'Bearer live-secret-value should not render',
            vaultRef: 'vault-live-secret-123',
          },
        ]}
        onActorChange={() => undefined}
        onRefresh={() => undefined}
        onBumpState={() => undefined}
        onSearchTermChange={() => undefined}
        onPackContextChange={() => undefined}
        onSearch={() => undefined}
        onSetHitStatus={() => Promise.resolve(true)}
        onEmbedMemory={() => undefined}
        onCaptureTitleChange={() => undefined}
        onCaptureTextChange={() => undefined}
        onCaptureText={() => undefined}
        onPreviewExtraction={() => undefined}
        onApplyExtraction={() => undefined}
        onToggleExtractionSelected={() => undefined}
        onDocTitleChange={() => undefined}
        onDocFileChange={() => undefined}
        onCaptureDocument={() => undefined}
        onLinkUrlChange={() => undefined}
        onLinkTitleChange={() => undefined}
        onCaptureLink={() => undefined}
        onRefreshReviewQueue={() => undefined}
        onBulkReviewStatus={() => undefined}
        onRunConsolidation={() => undefined}
        onEmbedMissing={() => undefined}
        onJobLookupIdChange={() => undefined}
        onLoadJob={() => undefined}
        onProcessJob={() => undefined}
        onConnectGmailStub={() => undefined}
        onStartOAuth={() => undefined}
        onSyncConnections={() => undefined}
        onLoadOutbox={() => undefined}
        onExportMemories={() => undefined}
        onDeadLetterJobs={() => undefined}
        onAckOutbox={() => undefined}
        onUpdateConnectionStatus={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('OpsPage', () => {
  it('renders the official M14 support / ops pack links and ownership', () => {
    const html = renderOpsPage();

    expect(html).toContain('m14-s10-v1');
    expect(html).toContain('RG5 support+ownership');
    expect(html).toContain('Platform on-call');
    expect(html).toContain('Security on-call');
    expect(html).toContain('Connector on-call');
    expect(html).toContain('Privacy owner');
    expect(html).toContain('Actor switching below stays demo-only');
    expect(html).toContain('href="/ops"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain('href="/connections"');
    expect(html).toContain(
      'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/blob/main/docs/engineering/M14_SLICE_01.md',
    );
    expect(html).toContain(
      'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/blob/main/docs/engineering/runbooks/alert-ownership-and-routing.md',
    );
    expect(html).toContain(
      'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/blob/main/docs/engineering/privacy/EXPORT_DELETION_SLAS.md',
    );
    expect(html).toContain(
      'https://github.com/2qjckdknjf-ctrl/sasha-memory-os/blob/main/docs/engineering/ONBOARDING.md',
    );
  });

  it('keeps raw payloads, tokens, vault refs, and memory bodies out of rendered ops output', () => {
    const html = renderOpsPage();

    expect(html).not.toContain('family travel top-secret-token');
    expect(html).not.toContain('memory body should never be logged or rendered here');
    expect(html).not.toContain('export payload body should stay out of the ops surface');
    expect(html).not.toContain('connector payload text should not show here');
    expect(html).not.toContain('live-secret-token');
    expect(html).not.toContain('sensitive export payload body');
    expect(html).not.toContain('Bearer live-secret-value should not render');
    expect(html).not.toContain('vault-live-secret-123');
    expect(html).not.toContain('preview-secret-should-never-render-112233');
    expect(html).not.toContain('capture-secret-should-never-render-998877');
    expect(html).toContain('Redacted on /ops');
  });

  it('does not render live approve, export, or revoke controls on the official ops surface', () => {
    const html = renderOpsPage();

    expect(html).not.toContain('Approve');
    expect(html).not.toContain('Approve all');
    expect(html).not.toContain('Export memories JSON');
    expect(html).not.toContain('Revoke');
    expect(html).toContain('Dispute');
    expect(html).toContain('Retract');
    expect(html).toContain('Reauth');
    expect(html).toContain('Mark connected');
  });
});

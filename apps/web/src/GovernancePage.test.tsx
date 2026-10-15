import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GovernancePage } from './GovernancePage';

describe('M19 governance owner surface', () => {
  it('links every mandatory surface without demo actor switching', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GovernancePage
          actor="owner"
          backend="local"
          backendResolved
          subjectId="33333333-3333-4333-8333-333333333301"
          projectId="44444444-4444-4444-8444-444444444402"
          projects={[
            {
              id: '44444444-4444-4444-8444-444444444402',
              slug: 'sasha-memory-os',
              name: 'Sasha Memory OS',
              status: 'active',
            },
          ]}
          scopeLabel="Sasha Memory OS"
          scopePanel={<div>Project scope</div>}
        />
      </MemoryRouter>,
    );

    expect(html).toContain('Состояние и контроль Memory OS');
    expect(html).toContain('UNCLASSIFIED');
    expect(html).toContain('dead letters');
    expect(html).toContain('href="/projects"');
    expect(html).toContain('href="/connections"');
    expect(html).toContain('href="/conflicts"');
    expect(html).toContain('href="/entities"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/search"');
    expect(html).not.toContain('onActorChange');
  });

  it('fails closed for a non-owner actor', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GovernancePage
          actor="cursor"
          backend="supabase"
          backendResolved
          subjectId="33333333-3333-4333-8333-333333333303"
          projectId={null}
          projects={[]}
          scopeLabel="всем проектам"
          scopePanel={<div>Project scope</div>}
        />
      </MemoryRouter>,
    );
    expect(html).toContain('доступна только владельцу');
    expect(html).toContain('disabled');
  });
});

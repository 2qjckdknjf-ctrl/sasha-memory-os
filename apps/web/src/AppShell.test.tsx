import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

function renderShell(seedShortcutTo: string | null) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AppShell
        backend="local"
        boundSubjectId={null}
        authPanel={null}
        error={null}
        notice={null}
        seedShortcutTo={seedShortcutTo}
      >
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe('AppShell', () => {
  it('hides the AISTROYKA shortcut when the seed project is absent from the catalog', () => {
    const html = renderShell(null);

    expect(html).not.toContain('Проект AISTROYKA');
  });

  it('shows the AISTROYKA shortcut only when the seed project exists in the catalog', () => {
    const html = renderShell('44444444-4444-4444-8444-444444444401');

    expect(html).toContain('Проект AISTROYKA');
    expect(html).toContain('/projects/44444444-4444-4444-8444-444444444401');
  });
});

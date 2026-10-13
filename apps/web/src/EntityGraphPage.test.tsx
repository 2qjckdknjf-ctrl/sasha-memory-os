import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { EntityGraphPage } from './EntityGraphPage';

describe('EntityGraphPage', () => {
  it('requires an explicit project before graph search', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/entities']}>
        <Routes>
          <Route
            path="/entities"
            element={
              <EntityGraphPage
                actor="cursor"
                backend="local"
                backendResolved
                subjectId="33333333-3333-4333-8333-333333333303"
                projectId={null}
                scopeLabel="всем проектам"
                scopePanel={<div>scope panel</div>}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Сущности и связи');
    expect(html).toContain('Для графа нужно выбрать конкретный проект.');
    expect(html).toContain('disabled=""');
  });
});

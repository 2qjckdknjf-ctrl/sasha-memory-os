import { Link } from 'react-router-dom';
import type { ProjectRecord } from './controlCenter';

type Props = {
  projects: ProjectRecord[];
};

export function ProjectsPage({ projects }: Props) {
  return (
    <section className="page">
      <header className="page-header">
        <p className="eyebrow">Проекты</p>
        <h1>Каталог проектов Memory OS</h1>
        <p className="lede">
          Здесь видны все проекты, которые уже есть в памяти или были автоматически созданы из
          GitHub discover/sync.
        </p>
      </header>

      <section className="panel">
        <h2>Проекты рабочей области</h2>
        {projects.length === 0 ? (
          <p className="hint">Проекты ещё не обнаружены.</p>
        ) : (
          <ul className="timeline" aria-label="Список проектов">
            {projects.map((project) => (
              <li className="item" key={project.id}>
                <div className="meta">
                  <span className="badge state">{project.status}</span>
                  <span>{project.slug}</span>
                </div>
                <h3>{project.name}</h3>
                {project.url ? <p className="hint">{project.url}</p> : null}
                <div className="actions">
                  <Link to={`/projects/${project.id}`} className="button-link button-link--secondary">
                    Открыть проект
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

import type { ProjectRecord } from './controlCenter';
import { describeProjectScope, findProjectById } from './projectScope';

type Props = {
  projects: ProjectRecord[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
};

export function ProjectScopePanel({ projects, selectedProjectId, onSelectProject }: Props) {
  const selectedProject = findProjectById(projects, selectedProjectId);
  const scopeLabel = describeProjectScope(selectedProject);

  return (
    <section className="panel panel--note">
      <h2>Область чтения и записи</h2>
      <p className="hint">
        Сейчас глобальные страницы читают данные по {scopeLabel}. Чтобы сузить область до одного
        проекта и использовать его как явную цель для записей, выберите проект ниже.
      </p>
      <div className="actions">
        <label>
          Проект
          <select
            value={selectedProjectId ?? ''}
            onChange={(event) => onSelectProject(event.target.value || null)}
          >
            <option value="">Вся рабочая область</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button-secondary"
          disabled={!selectedProjectId}
          onClick={() => onSelectProject(null)}
        >
          Очистить фильтр
        </button>
      </div>
      {selectedProject ? (
        <p className="hint">
          Глобальные записи сейчас будут адресованы проекту <strong>{selectedProject.name}</strong>.
        </p>
      ) : (
        <p className="hint">
          При пустом фильтре чтение остается workspace-wide, а запись требует открыть{' '}
          <code>/projects/:id</code> или выбрать проект здесь.
        </p>
      )}
    </section>
  );
}

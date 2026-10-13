-- M17.4 advisor hardening: make every graph FK independently indexable and
-- keep SELECT policies separate from mutation policies. Direct client grants
-- remain revoked; these policies are defense in depth for trusted runtimes.

CREATE INDEX IF NOT EXISTS idx_entities_project_fk
  ON public.entities (project_id);
CREATE INDEX IF NOT EXISTS idx_entities_source_event_fk
  ON public.entities (source_event_id);
CREATE INDEX IF NOT EXISTS idx_entities_merged_into_fk
  ON public.entities (merged_into_entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_source_event_fk
  ON public.entity_aliases (source_event_id);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_memory_fk
  ON public.entity_aliases (memory_id);

CREATE INDEX IF NOT EXISTS idx_entity_edges_project_fk
  ON public.entity_edges (project_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_from_fk
  ON public.entity_edges (from_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_to_fk
  ON public.entity_edges (to_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_source_event_fk
  ON public.entity_edges (source_event_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_memory_fk
  ON public.entity_edges (memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_entities_project_fk
  ON public.memory_entities (project_id);

DROP POLICY IF EXISTS entities_write ON public.entities;
CREATE POLICY entities_insert ON public.entities
  FOR INSERT WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );
CREATE POLICY entities_update ON public.entities
  FOR UPDATE USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  ) WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );
CREATE POLICY entities_delete ON public.entities
  FOR DELETE USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );

DROP POLICY IF EXISTS entity_aliases_write ON public.entity_aliases;
CREATE POLICY entity_aliases_insert ON public.entity_aliases
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.entities e
      WHERE e.id = entity_aliases.entity_id
        AND app.has_acl(e.workspace_id, 'memory', 'write', e.project_id)
    )
  );
CREATE POLICY entity_aliases_update ON public.entity_aliases
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.entities e
      WHERE e.id = entity_aliases.entity_id
        AND app.has_acl(e.workspace_id, 'memory', 'write', e.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.entities e
      WHERE e.id = entity_aliases.entity_id
        AND app.has_acl(e.workspace_id, 'memory', 'write', e.project_id)
    )
  );
CREATE POLICY entity_aliases_delete ON public.entity_aliases
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.entities e
      WHERE e.id = entity_aliases.entity_id
        AND app.has_acl(e.workspace_id, 'memory', 'write', e.project_id)
    )
  );

DROP POLICY IF EXISTS entity_edges_write ON public.entity_edges;
CREATE POLICY entity_edges_insert ON public.entity_edges
  FOR INSERT WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );
CREATE POLICY entity_edges_update ON public.entity_edges
  FOR UPDATE USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  ) WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );
CREATE POLICY entity_edges_delete ON public.entity_edges
  FOR DELETE USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );

DROP POLICY IF EXISTS memory_entities_write ON public.memory_entities;
CREATE POLICY memory_entities_insert ON public.memory_entities
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.memory_records m
      WHERE m.id = memory_entities.memory_id
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'write',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    )
  );
CREATE POLICY memory_entities_update ON public.memory_entities
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.memory_records m
      WHERE m.id = memory_entities.memory_id
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'write',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.memory_records m
      WHERE m.id = memory_entities.memory_id
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'write',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    )
  );
CREATE POLICY memory_entities_delete ON public.memory_entities
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.memory_records m
      WHERE m.id = memory_entities.memory_id
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'write',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    )
  );

REVOKE ALL ON TABLE public.entities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entity_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entity_edges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.memory_entities FROM PUBLIC, anon, authenticated;

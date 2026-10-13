-- M17 Slice 04: durable entity graph schema and idempotent backfill.
--
-- The graph is an additive projection. Existing memory/source identifiers are
-- never rewritten, and every entity assertion keeps a stable source reference.

CREATE TABLE public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects (id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  entity_class text NOT NULL CHECK (entity_class IN (
    'person', 'project', 'company', 'repository', 'document', 'file',
    'photo_asset', 'conversation', 'email', 'calendar_event', 'idea',
    'decision', 'task', 'goal', 'risk', 'place', 'device', 'source_account'
  )),
  canonical_name text NOT NULL CHECK (btrim(canonical_name) <> ''),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'merged', 'split', 'archived')),
  confidence numeric(4, 3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  valid_from timestamptz,
  valid_to timestamptz,
  source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
  source_event_id uuid REFERENCES public.source_events (id) ON DELETE SET NULL,
  created_from_memory_id uuid REFERENCES public.memory_records (id) ON DELETE SET NULL,
  merged_into_entity_id uuid REFERENCES public.entities (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_stable_id_not_blank CHECK (btrim(stable_id) <> ''),
  CONSTRAINT entities_valid_interval CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from
  ),
  CONSTRAINT entities_no_self_merge CHECK (
    merged_into_entity_id IS NULL OR merged_into_entity_id <> id
  ),
  UNIQUE (workspace_id, stable_id)
);

CREATE TABLE public.entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  alias text NOT NULL CHECK (btrim(alias) <> ''),
  normalized_alias text NOT NULL CHECK (
    normalized_alias = lower(btrim(alias)) AND normalized_alias <> ''
  ),
  confidence numeric(4, 3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
  source_event_id uuid REFERENCES public.source_events (id) ON DELETE SET NULL,
  memory_id uuid REFERENCES public.memory_records (id) ON DELETE SET NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_aliases_valid_interval CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from
  ),
  UNIQUE (entity_id, normalized_alias, source_ref)
);

CREATE TABLE public.entity_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  from_entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  edge_type text NOT NULL CHECK (edge_type IN (
    'owns', 'works_on', 'belongs_to', 'depends_on', 'supersedes',
    'decided_in', 'sourced_from', 'blocks', 'relates_to', 'assigned_to',
    'scheduled_at', 'stored_in'
  )),
  to_entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  confidence numeric(4, 3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
  source_event_id uuid REFERENCES public.source_events (id) ON DELETE SET NULL,
  memory_id uuid REFERENCES public.memory_records (id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz,
  valid_to timestamptz,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_edges_distinct_nodes CHECK (from_entity_id <> to_entity_id),
  CONSTRAINT entity_edges_valid_interval CHECK (
    valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from
  ),
  CONSTRAINT entity_edges_require_evidence CHECK (
    source_event_id IS NOT NULL OR memory_id IS NOT NULL OR evidence <> '{}'::jsonb
  ),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE public.memory_entities (
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES public.memory_records (id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES public.entities (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('subject', 'project_context', 'source')),
  confidence numeric(4, 3) NOT NULL DEFAULT 1
    CHECK (confidence >= 0 AND confidence <= 1),
  source_ref text NOT NULL CHECK (btrim(source_ref) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, entity_id, role)
);

CREATE INDEX idx_entities_scope_class
  ON public.entities (workspace_id, project_id, entity_class, status);
CREATE INDEX idx_entities_created_from_memory
  ON public.entities (created_from_memory_id)
  WHERE created_from_memory_id IS NOT NULL;
CREATE INDEX idx_entity_aliases_lookup
  ON public.entity_aliases (workspace_id, normalized_alias);
CREATE INDEX idx_entity_edges_from
  ON public.entity_edges (workspace_id, project_id, from_entity_id, edge_type);
CREATE INDEX idx_entity_edges_to
  ON public.entity_edges (workspace_id, project_id, to_entity_id, edge_type);
CREATE INDEX idx_memory_entities_entity
  ON public.memory_entities (entity_id, memory_id);
CREATE INDEX idx_memory_entities_scope
  ON public.memory_entities (workspace_id, project_id, memory_id);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entity_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entity_edges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.memory_entities FORCE ROW LEVEL SECURITY;

CREATE POLICY entities_select ON public.entities
  FOR SELECT USING (
    app.has_acl(workspace_id, 'memory', 'read', project_id)
  );

CREATE POLICY entities_write ON public.entities
  FOR ALL USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  ) WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );

CREATE POLICY entity_aliases_select ON public.entity_aliases
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.entities e
      WHERE e.id = entity_aliases.entity_id
        AND app.has_acl(e.workspace_id, 'memory', 'read', e.project_id)
    )
  );

CREATE POLICY entity_aliases_write ON public.entity_aliases
  FOR ALL USING (
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

CREATE POLICY entity_edges_select ON public.entity_edges
  FOR SELECT USING (
    app.has_acl(workspace_id, 'memory', 'read', project_id)
  );

CREATE POLICY entity_edges_write ON public.entity_edges
  FOR ALL USING (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  ) WITH CHECK (
    app.has_acl(workspace_id, 'memory', 'write', project_id)
  );

CREATE POLICY memory_entities_select ON public.memory_entities
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.memory_records m
      WHERE m.id = memory_entities.memory_id
        AND app.has_acl(
          m.workspace_id,
          'memory',
          'read',
          app.effective_memory_project_id(m.id),
          m.sensitivity
        )
    )
  );

CREATE POLICY memory_entities_write ON public.memory_entities
  FOR ALL USING (
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

REVOKE ALL ON TABLE public.entities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entity_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.entity_edges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.memory_entities FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.entities TO service_role;
GRANT ALL ON TABLE public.entity_aliases TO service_role;
GRANT ALL ON TABLE public.entity_edges TO service_role;
GRANT ALL ON TABLE public.memory_entities TO service_role;

CREATE OR REPLACE FUNCTION app.api_backfill_entity_graph(
  p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = p_project_id
  ) THEN
    RAISE EXCEPTION 'project not found';
  END IF;

  -- Reconcile privacy state before adding/updating the projection. Canonical
  -- memory rows remain untouched; only graph rows derived from deleted memory
  -- are removed.
  DELETE FROM public.entity_edges ee
  USING public.memory_records m
  WHERE ee.memory_id = m.id
    AND m.status = 'deleted'
    AND (
      p_project_id IS NULL
      OR app.effective_memory_project_id(m.id) = p_project_id
    );

  DELETE FROM public.memory_entities me
  USING public.memory_records m
  WHERE me.memory_id = m.id
    AND m.status = 'deleted'
    AND (
      p_project_id IS NULL
      OR app.effective_memory_project_id(m.id) = p_project_id
    );

  DELETE FROM public.entities e
  USING public.memory_records m
  WHERE e.created_from_memory_id = m.id
    AND m.status = 'deleted'
    AND (
      p_project_id IS NULL
      OR app.effective_memory_project_id(m.id) = p_project_id
    );

  -- Every project receives one stable entity. Re-runs update mutable display
  -- fields while retaining the original entity UUID and stable identifier.
  INSERT INTO public.entities (
    workspace_id, project_id, stable_id, entity_class, canonical_name,
    status, confidence, source_ref, metadata
  )
  SELECT
    p.workspace_id,
    p.id,
    'entity:project:memory-os-project:' || p.id::text,
    'project',
    p.name,
    CASE WHEN p.status = 'archived' THEN 'archived' ELSE 'active' END,
    1,
    'project:' || p.id::text,
    jsonb_build_object('backfillPack', 'm17-s04-v1', 'projectSlug', p.slug)
  FROM public.projects p
  WHERE p_project_id IS NULL OR p.id = p_project_id
  ON CONFLICT (workspace_id, stable_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    canonical_name = EXCLUDED.canonical_name,
    status = EXCLUDED.status,
    source_ref = EXCLUDED.source_ref,
    metadata = public.entities.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.entity_aliases (
    workspace_id, entity_id, alias, normalized_alias, confidence, source_ref
  )
  SELECT DISTINCT ON (e.id, lower(btrim(candidate.alias)))
    p.workspace_id,
    e.id,
    candidate.alias,
    lower(btrim(candidate.alias)),
    1,
    'project:' || p.id::text
  FROM public.projects p
  JOIN public.entities e
    ON e.workspace_id = p.workspace_id
   AND e.stable_id = 'entity:project:memory-os-project:' || p.id::text
  CROSS JOIN LATERAL (
    SELECT p.name AS alias
    UNION ALL SELECT p.slug
    UNION ALL SELECT unnest(p.aliases)
  ) candidate
  WHERE (p_project_id IS NULL OR p.id = p_project_id)
    AND btrim(candidate.alias) <> ''
  ON CONFLICT (entity_id, normalized_alias, source_ref) DO UPDATE SET
    alias = EXCLUDED.alias,
    confidence = EXCLUDED.confidence;

  -- Repository identities come only from structured project metadata. No
  -- free-text entity guessing is performed during migration.
  INSERT INTO public.entities (
    workspace_id, project_id, stable_id, entity_class, canonical_name,
    status, confidence, source_ref, metadata
  )
  SELECT DISTINCT
    p.workspace_id,
    p.id,
    'entity:repository:' || lower(coalesce(nullif(repo->>'provider', ''), 'unknown'))
      || ':' || coalesce(nullif(repo->>'repository', ''), nullif(repo->>'url', ''))
      || ':project:' || p.id::text,
    'repository',
    coalesce(nullif(repo->>'repository', ''), nullif(repo->>'url', '')),
    'active',
    1,
    'project:' || p.id::text || ':repository:'
      || coalesce(nullif(repo->>'repository', ''), nullif(repo->>'url', '')),
    jsonb_build_object('backfillPack', 'm17-s04-v1', 'repository', repo)
  FROM public.projects p
  CROSS JOIN LATERAL jsonb_array_elements(p.repositories) repo
  WHERE (p_project_id IS NULL OR p.id = p_project_id)
    AND coalesce(nullif(repo->>'repository', ''), nullif(repo->>'url', '')) IS NOT NULL
  ON CONFLICT (workspace_id, stable_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    canonical_name = EXCLUDED.canonical_name,
    source_ref = EXCLUDED.source_ref,
    metadata = public.entities.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.entity_aliases (
    workspace_id, entity_id, alias, normalized_alias, confidence, source_ref
  )
  SELECT DISTINCT ON (e.id, lower(btrim(candidate.alias)))
    p.workspace_id,
    e.id,
    candidate.alias,
    lower(btrim(candidate.alias)),
    1,
    e.source_ref
  FROM public.projects p
  CROSS JOIN LATERAL jsonb_array_elements(p.repositories) repo
  CROSS JOIN LATERAL (
    SELECT nullif(repo->>'repository', '') AS alias
    UNION ALL SELECT nullif(repo->>'url', '')
  ) candidate
  JOIN public.entities e
    ON e.workspace_id = p.workspace_id
   AND e.stable_id = 'entity:repository:'
      || lower(coalesce(nullif(repo->>'provider', ''), 'unknown'))
      || ':' || coalesce(nullif(repo->>'repository', ''), nullif(repo->>'url', ''))
      || ':project:' || p.id::text
  WHERE (p_project_id IS NULL OR p.id = p_project_id)
    AND btrim(coalesce(candidate.alias, '')) <> ''
  ON CONFLICT (entity_id, normalized_alias, source_ref) DO UPDATE SET
    alias = EXCLUDED.alias,
    confidence = EXCLUDED.confidence;

  INSERT INTO public.entity_edges (
    workspace_id, project_id, from_entity_id, edge_type, to_entity_id,
    confidence, source_ref, evidence, idempotency_key
  )
  SELECT
    repository.workspace_id,
    repository.project_id,
    repository.id,
    'belongs_to',
    project.id,
    1,
    repository.source_ref,
    jsonb_build_object('origin', 'projects.repositories', 'backfillPack', 'm17-s04-v1'),
    'edge:belongs_to:' || repository.stable_id || '->' || project.stable_id
  FROM public.entities repository
  JOIN public.entities project
    ON project.workspace_id = repository.workspace_id
   AND project.project_id = repository.project_id
   AND project.entity_class = 'project'
  WHERE repository.entity_class = 'repository'
    AND (p_project_id IS NULL OR repository.project_id = p_project_id)
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref,
    evidence = EXCLUDED.evidence;

  -- Connector identities remain workspace-scoped until a source event proves
  -- a project relationship.
  INSERT INTO public.entities (
    workspace_id, project_id, stable_id, entity_class, canonical_name,
    status, confidence, source_ref, metadata
  )
  SELECT
    ca.workspace_id,
    NULL,
    'entity:source_account:' || ca.connector_id || ':' || ca.id::text,
    'source_account',
    ca.display_name,
    CASE WHEN ca.status IN ('revoked', 'disabled') THEN 'archived' ELSE 'active' END,
    1,
    'connector_account:' || ca.id::text,
    jsonb_build_object(
      'backfillPack', 'm17-s04-v1',
      'connectorId', ca.connector_id,
      'connectionStatus', ca.status
    )
  FROM public.connector_accounts ca
  WHERE p_project_id IS NULL
     OR ca.workspace_id = (SELECT p.workspace_id FROM public.projects p WHERE p.id = p_project_id)
  ON CONFLICT (workspace_id, stable_id) DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name,
    status = EXCLUDED.status,
    source_ref = EXCLUDED.source_ref,
    metadata = public.entities.metadata || EXCLUDED.metadata,
    updated_at = now();

  -- Decisions, tasks, and ideas have a lossless one-to-one entity mapping.
  -- Other memory types are linked to their project entity without guessing a
  -- class from free text.
  INSERT INTO public.entities (
    workspace_id, project_id, stable_id, entity_class, canonical_name,
    status, confidence, valid_from, valid_to, source_ref, source_event_id,
    created_from_memory_id, metadata
  )
  SELECT
    m.workspace_id,
    effective.project_id,
    'entity:' || m.memory_type || ':memory:' || m.id::text,
    m.memory_type,
    m.title,
    CASE WHEN m.status IN ('superseded', 'retracted') THEN 'archived' ELSE 'active' END,
    m.confidence,
    m.valid_from,
    m.valid_to,
    'memory:' || m.id::text,
    m.source_event_id,
    m.id,
    jsonb_build_object(
      'backfillPack', 'm17-s04-v1',
      'memoryStatus', m.status,
      'memorySchemaVersion', m.schema_version
    )
  FROM public.memory_records m
  CROSS JOIN LATERAL (
    SELECT app.effective_memory_project_id(m.id) AS project_id
  ) effective
  WHERE m.memory_type IN ('decision', 'task', 'idea')
    AND m.status <> 'deleted'
    AND effective.project_id IS NOT NULL
    AND (p_project_id IS NULL OR effective.project_id = p_project_id)
  ON CONFLICT (workspace_id, stable_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    canonical_name = EXCLUDED.canonical_name,
    status = EXCLUDED.status,
    confidence = EXCLUDED.confidence,
    valid_from = EXCLUDED.valid_from,
    valid_to = EXCLUDED.valid_to,
    source_ref = EXCLUDED.source_ref,
    source_event_id = EXCLUDED.source_event_id,
    created_from_memory_id = EXCLUDED.created_from_memory_id,
    metadata = public.entities.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.entity_aliases (
    workspace_id, entity_id, alias, normalized_alias, confidence,
    source_ref, source_event_id, memory_id, valid_from, valid_to
  )
  SELECT
    m.workspace_id,
    e.id,
    m.title,
    lower(btrim(m.title)),
    m.confidence,
    'memory:' || m.id::text,
    m.source_event_id,
    m.id,
    m.valid_from,
    m.valid_to
  FROM public.memory_records m
  JOIN public.entities e
    ON e.workspace_id = m.workspace_id
   AND e.stable_id = 'entity:' || m.memory_type || ':memory:' || m.id::text
  WHERE m.memory_type IN ('decision', 'task', 'idea')
    AND m.status <> 'deleted'
    AND (p_project_id IS NULL OR e.project_id = p_project_id)
  ON CONFLICT (entity_id, normalized_alias, source_ref) DO UPDATE SET
    alias = EXCLUDED.alias,
    confidence = EXCLUDED.confidence,
    source_event_id = EXCLUDED.source_event_id,
    memory_id = EXCLUDED.memory_id,
    valid_from = EXCLUDED.valid_from,
    valid_to = EXCLUDED.valid_to;

  INSERT INTO public.memory_entities (
    workspace_id, project_id, memory_id, entity_id, role, confidence, source_ref
  )
  SELECT
    m.workspace_id,
    effective.project_id,
    m.id,
    project_entity.id,
    'project_context',
    1,
    'memory:' || m.id::text
  FROM public.memory_records m
  CROSS JOIN LATERAL (
    SELECT app.effective_memory_project_id(m.id) AS project_id
  ) effective
  JOIN public.entities project_entity
    ON project_entity.workspace_id = m.workspace_id
   AND project_entity.stable_id = 'entity:project:memory-os-project:' || effective.project_id::text
  WHERE m.status <> 'deleted'
    AND effective.project_id IS NOT NULL
    AND (p_project_id IS NULL OR effective.project_id = p_project_id)
  ON CONFLICT (memory_id, entity_id, role) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref;

  INSERT INTO public.memory_entities (
    workspace_id, project_id, memory_id, entity_id, role, confidence, source_ref
  )
  SELECT
    m.workspace_id,
    e.project_id,
    m.id,
    e.id,
    'subject',
    e.confidence,
    'memory:' || m.id::text
  FROM public.memory_records m
  JOIN public.entities e
    ON e.workspace_id = m.workspace_id
   AND e.created_from_memory_id = m.id
  WHERE m.status <> 'deleted'
    AND e.project_id IS NOT NULL
    AND (p_project_id IS NULL OR e.project_id = p_project_id)
  ON CONFLICT (memory_id, entity_id, role) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref;

  INSERT INTO public.entity_edges (
    workspace_id, project_id, from_entity_id, edge_type, to_entity_id,
    confidence, source_ref, source_event_id, memory_id, evidence,
    valid_from, valid_to, idempotency_key
  )
  SELECT
    memory_entity.workspace_id,
    memory_entity.project_id,
    memory_entity.id,
    'belongs_to',
    project_entity.id,
    memory_entity.confidence,
    memory_entity.source_ref,
    memory_entity.source_event_id,
    memory_entity.created_from_memory_id,
    jsonb_build_object('origin', 'memory_records', 'backfillPack', 'm17-s04-v1'),
    memory_entity.valid_from,
    memory_entity.valid_to,
    'edge:belongs_to:' || memory_entity.stable_id || '->' || project_entity.stable_id
  FROM public.entities memory_entity
  JOIN public.entities project_entity
    ON project_entity.workspace_id = memory_entity.workspace_id
   AND project_entity.project_id = memory_entity.project_id
   AND project_entity.entity_class = 'project'
  WHERE memory_entity.created_from_memory_id IS NOT NULL
    AND (p_project_id IS NULL OR memory_entity.project_id = p_project_id)
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref,
    source_event_id = EXCLUDED.source_event_id,
    memory_id = EXCLUDED.memory_id,
    evidence = EXCLUDED.evidence,
    valid_from = EXCLUDED.valid_from,
    valid_to = EXCLUDED.valid_to;

  INSERT INTO public.memory_entities (
    workspace_id, project_id, memory_id, entity_id, role, confidence, source_ref
  )
  SELECT
    m.workspace_id,
    effective.project_id,
    m.id,
    source_account.id,
    'source',
    1,
    'source_event:' || se.id::text
  FROM public.memory_records m
  JOIN public.source_events se ON se.id = m.source_event_id
  CROSS JOIN LATERAL (
    SELECT app.effective_memory_project_id(m.id) AS project_id
  ) effective
  JOIN public.entities source_account
    ON source_account.workspace_id = m.workspace_id
   AND source_account.source_ref = 'connector_account:' || se.connector_account_id::text
  WHERE se.connector_account_id IS NOT NULL
    AND m.status <> 'deleted'
    AND effective.project_id IS NOT NULL
    AND (p_project_id IS NULL OR effective.project_id = p_project_id)
  ON CONFLICT (memory_id, entity_id, role) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref;

  INSERT INTO public.entity_edges (
    workspace_id, project_id, from_entity_id, edge_type, to_entity_id,
    confidence, source_ref, source_event_id, memory_id, evidence,
    idempotency_key
  )
  SELECT
    memory_entity.workspace_id,
    memory_entity.project_id,
    memory_entity.id,
    'sourced_from',
    source_link.entity_id,
    1,
    source_link.source_ref,
    m.source_event_id,
    m.id,
    jsonb_build_object('origin', 'source_events', 'backfillPack', 'm17-s04-v1'),
    'edge:sourced_from:' || memory_entity.stable_id || '->' || source_account.stable_id
  FROM public.memory_records m
  JOIN public.entities memory_entity
    ON memory_entity.created_from_memory_id = m.id
  JOIN public.memory_entities source_link
    ON source_link.memory_id = m.id
   AND source_link.role = 'source'
  JOIN public.entities source_account ON source_account.id = source_link.entity_id
  WHERE m.status <> 'deleted'
    AND (p_project_id IS NULL OR memory_entity.project_id = p_project_id)
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref,
    source_event_id = EXCLUDED.source_event_id,
    memory_id = EXCLUDED.memory_id,
    evidence = EXCLUDED.evidence;

  INSERT INTO public.entity_edges (
    workspace_id, project_id, from_entity_id, edge_type, to_entity_id,
    confidence, source_ref, memory_id, evidence, idempotency_key
  )
  SELECT
    newer.workspace_id,
    newer.project_id,
    newer.id,
    'supersedes',
    older.id,
    1,
    'memory:' || newer.created_from_memory_id::text,
    newer.created_from_memory_id,
    jsonb_build_object('origin', 'memory_records.superseded_by', 'backfillPack', 'm17-s04-v1'),
    'edge:supersedes:' || newer.stable_id || '->' || older.stable_id
  FROM public.memory_records old_memory
  JOIN public.entities older ON older.created_from_memory_id = old_memory.id
  JOIN public.entities newer ON newer.created_from_memory_id = old_memory.superseded_by
  WHERE old_memory.superseded_by IS NOT NULL
    AND newer.project_id = older.project_id
    AND (p_project_id IS NULL OR newer.project_id = p_project_id)
  ON CONFLICT (workspace_id, idempotency_key) DO UPDATE SET
    confidence = EXCLUDED.confidence,
    source_ref = EXCLUDED.source_ref,
    memory_id = EXCLUDED.memory_id,
    evidence = EXCLUDED.evidence;

  SELECT jsonb_build_object(
    'packVersion', 'm17-s04-v1',
    'projectId', p_project_id,
    'eligibleMemories', (
      SELECT count(*)
      FROM public.memory_records m
      WHERE m.status <> 'deleted'
        AND app.effective_memory_project_id(m.id) IS NOT NULL
        AND (
          p_project_id IS NULL
          OR app.effective_memory_project_id(m.id) = p_project_id
        )
    ),
    'projectContextLinks', (
      SELECT count(*)
      FROM public.memory_entities me
      WHERE me.role = 'project_context'
        AND (p_project_id IS NULL OR me.project_id = p_project_id)
    ),
    'directMemoryEntities', (
      SELECT count(*)
      FROM public.entities e
      WHERE e.created_from_memory_id IS NOT NULL
        AND (p_project_id IS NULL OR e.project_id = p_project_id)
    ),
    'entities', (
      SELECT count(*)
      FROM public.entities e
      WHERE p_project_id IS NULL OR e.project_id = p_project_id
    ),
    'aliases', (
      SELECT count(*)
      FROM public.entity_aliases ea
      JOIN public.entities e ON e.id = ea.entity_id
      WHERE p_project_id IS NULL OR e.project_id = p_project_id
    ),
    'edges', (
      SELECT count(*)
      FROM public.entity_edges ee
      WHERE p_project_id IS NULL OR ee.project_id = p_project_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION app.api_backfill_entity_graph(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.api_backfill_entity_graph(uuid) TO service_role;

-- Backfill all existing workspaces inside the migration transaction. This is
-- safe to repeat because stable IDs and edge idempotency keys are unique.
SELECT app.api_backfill_entity_graph(NULL);

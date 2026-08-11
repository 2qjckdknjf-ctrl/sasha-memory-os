-- WP-02: RLS helpers and policies (baseline §6.6, §16.2)

-- Session GUC: app.subject_id, app.workspace_id (set by API/MCP after auth)
CREATE OR REPLACE FUNCTION app.current_subject_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.subject_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.is_workspace_member(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_memberships wm
    JOIN subjects s ON s.id = wm.subject_id
    WHERE wm.workspace_id = p_workspace_id
      AND s.id = app.current_subject_id()
  )
  OR EXISTS (
    SELECT 1
    FROM subjects s
    WHERE s.id = app.current_subject_id()
      AND s.workspace_id = p_workspace_id
      AND s.kind IN ('user', 'agent', 'service')
  );
$$;

CREATE OR REPLACE FUNCTION app.has_acl(
  p_workspace_id uuid,
  p_resource_type text,
  p_action text,
  p_project_id uuid DEFAULT NULL,
  p_sensitivity text DEFAULT 'internal'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_subject uuid := app.current_subject_id();
  v_denied boolean;
  v_allowed boolean;
BEGIN
  IF v_subject IS NULL THEN
    RETURN false;
  END IF;

  IF NOT app.is_workspace_member(p_workspace_id) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_subject
      AND a.effect = 'deny'
      AND a.resource_type IN (p_resource_type, '*')
      AND (a.project_id IS NULL OR a.project_id = p_project_id)
      AND (a.actions = '{}' OR p_action = ANY (a.actions))
  ) INTO v_denied;

  IF v_denied THEN
    RETURN false;
  END IF;

  -- Owners (user membership) get broad access unless denied
  IF EXISTS (
    SELECT 1 FROM workspace_memberships wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.subject_id = v_subject
      AND wm.role = 'owner'
  ) THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM acl_entries a
    WHERE a.workspace_id = p_workspace_id
      AND a.subject_id = v_subject
      AND a.effect = 'allow'
      AND a.resource_type IN (p_resource_type, '*')
      AND (a.project_id IS NULL OR a.project_id = p_project_id)
      AND (a.actions = '{}' OR p_action = ANY (a.actions))
      AND (
        a.sensitivity_max IS NULL
        OR app.sensitivity_rank(p_sensitivity) <= app.sensitivity_rank(a.sensitivity_max)
      )
  ) INTO v_allowed;

  RETURN v_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION app.sensitivity_rank(p_value text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_value
    WHEN 'public' THEN 1
    WHEN 'internal' THEN 2
    WHEN 'personal' THEN 3
    WHEN 'confidential' THEN 4
    WHEN 'restricted' THEN 5
    ELSE 2
  END;
$$;

-- Enable RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE acl_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_state_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE source_events FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_records FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Workspace-scoped SELECT policies
CREATE POLICY workspaces_select ON workspaces
  FOR SELECT USING (app.is_workspace_member(id));

CREATE POLICY projects_select ON projects
  FOR SELECT USING (app.has_acl(workspace_id, 'project', 'read', id));

CREATE POLICY projects_write ON projects
  FOR ALL USING (app.has_acl(workspace_id, 'project', 'write', id))
  WITH CHECK (app.has_acl(workspace_id, 'project', 'write', id));

CREATE POLICY source_events_select ON source_events
  FOR SELECT USING (app.has_acl(workspace_id, 'source_event', 'read', project_id, sensitivity));

CREATE POLICY source_events_insert ON source_events
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'source_event', 'write', project_id, sensitivity));

-- Append-only: no UPDATE/DELETE for authenticated subjects
CREATE POLICY source_events_no_update ON source_events
  FOR UPDATE USING (false);

CREATE POLICY source_events_no_delete ON source_events
  FOR DELETE USING (false);

CREATE POLICY artifacts_select ON artifacts
  FOR SELECT USING (app.has_acl(workspace_id, 'artifact', 'read', project_id));

CREATE POLICY artifacts_insert ON artifacts
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'artifact', 'write', project_id));

CREATE POLICY memory_select ON memory_records
  FOR SELECT USING (app.has_acl(workspace_id, 'memory', 'read', project_id, sensitivity));

CREATE POLICY memory_write ON memory_records
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'memory', 'write', project_id, sensitivity));

CREATE POLICY memory_update ON memory_records
  FOR UPDATE USING (app.has_acl(workspace_id, 'memory', 'write', project_id, sensitivity))
  WITH CHECK (app.has_acl(workspace_id, 'memory', 'write', project_id, sensitivity));

CREATE POLICY decisions_select ON decisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = decisions.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    )
  );

CREATE POLICY decisions_write ON decisions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = decisions.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'write', m.project_id, m.sensitivity)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = decisions.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'write', m.project_id, m.sensitivity)
    )
  );

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = tasks.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'read', m.project_id, m.sensitivity)
    )
  );

CREATE POLICY tasks_write ON tasks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = tasks.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'write', m.project_id, m.sensitivity)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memory_records m
      WHERE m.id = tasks.memory_id
        AND app.has_acl(m.workspace_id, 'memory', 'write', m.project_id, m.sensitivity)
    )
  );

CREATE POLICY project_state_select ON project_state_versions
  FOR SELECT USING (app.has_acl(workspace_id, 'project_state', 'read', project_id));

CREATE POLICY project_state_insert ON project_state_versions
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'project_state', 'write', project_id));

CREATE POLICY handoffs_select ON handoffs
  FOR SELECT USING (app.has_acl(workspace_id, 'handoff', 'read', project_id));

CREATE POLICY handoffs_insert ON handoffs
  FOR INSERT WITH CHECK (app.has_acl(workspace_id, 'handoff', 'write', project_id));

CREATE POLICY evidence_select ON memory_evidence
  FOR SELECT USING (app.has_acl(workspace_id, 'memory', 'read', NULL));

CREATE POLICY revisions_select ON memory_revisions
  FOR SELECT USING (app.has_acl(workspace_id, 'memory', 'read', NULL));

CREATE POLICY sessions_all ON agent_sessions
  FOR ALL USING (app.has_acl(workspace_id, 'session', 'write', project_id))
  WITH CHECK (app.has_acl(workspace_id, 'session', 'write', project_id));

CREATE POLICY session_events_all ON session_events
  FOR ALL USING (app.has_acl(workspace_id, 'session', 'write', NULL))
  WITH CHECK (app.has_acl(workspace_id, 'session', 'write', NULL));

CREATE POLICY audit_select ON audit_log
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY audit_insert ON audit_log
  FOR INSERT WITH CHECK (app.is_workspace_member(workspace_id));

CREATE POLICY audit_no_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY audit_no_delete ON audit_log FOR DELETE USING (false);

CREATE POLICY access_select ON access_log
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY access_insert ON access_log
  FOR INSERT WITH CHECK (app.is_workspace_member(workspace_id));

CREATE POLICY outbox_all ON outbox_events
  FOR ALL USING (app.has_acl(workspace_id, 'outbox', 'write', NULL))
  WITH CHECK (app.has_acl(workspace_id, 'outbox', 'write', NULL));

CREATE POLICY jobs_all ON processing_jobs
  FOR ALL USING (app.has_acl(workspace_id, 'job', 'write', NULL))
  WITH CHECK (app.has_acl(workspace_id, 'job', 'write', NULL));

CREATE POLICY subjects_select ON subjects
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY agents_select ON agents
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY memberships_select ON workspace_memberships
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY acl_select ON acl_entries
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY roles_select ON roles
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY role_bindings_select ON role_bindings
  FOR SELECT USING (app.is_workspace_member(workspace_id));

CREATE POLICY api_clients_select ON api_clients
  FOR SELECT USING (app.is_workspace_member(workspace_id));

-- users: visible if share a workspace
CREATE POLICY users_select ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.user_id = users.id
        AND app.is_workspace_member(wm.workspace_id)
    )
  );

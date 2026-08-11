import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type MemoryOsEnv = {
  url: string;
  anonKey: string;
  apiSecret: string;
};

export function loadMemoryOsEnv(
  env: NodeJS.ProcessEnv = process.env,
): MemoryOsEnv | null {
  const url = env.MEMORY_OS_SUPABASE_URL;
  const anonKey =
    env.MEMORY_OS_SUPABASE_ANON_KEY || env.MEMORY_OS_SUPABASE_PUBLISHABLE_KEY;
  const apiSecret = env.MEMORY_OS_API_SECRET;
  if (!url || !anonKey || !apiSecret) return null;
  return { url, anonKey, apiSecret };
}

export function createMemoryOsClient(config: MemoryOsEnv): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseMemoryGateway {
  constructor(
    private readonly client: SupabaseClient,
    private readonly apiSecret: string,
  ) {}

  async projectContext(subjectId: string, projectId: string) {
    const { data, error } = await this.client.rpc('api_project_context', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_project_id: projectId,
    });
    if (error) throw error;
    return data;
  }

  async createDecision(input: {
    subjectId: string;
    workspaceId: string;
    projectId: string;
    title: string;
    content: string;
    idempotencyKey: string;
    importance?: number;
    confidence?: number;
    sensitivity?: string;
    rationale?: string;
  }) {
    const { data, error } = await this.client.rpc('api_create_decision', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_title: input.title,
      p_content: input.content,
      p_idempotency_key: input.idempotencyKey,
      p_importance: input.importance ?? 0.8,
      p_confidence: input.confidence ?? 0.9,
      p_sensitivity: input.sensitivity ?? 'internal',
      p_rationale: input.rationale ?? null,
    });
    if (error) throw error;
    return data;
  }

  async createHandoff(input: {
    subjectId: string;
    workspaceId: string;
    projectId: string;
    toSubjectId?: string;
    payload: Record<string, unknown>;
  }) {
    const { data, error } = await this.client.rpc('api_create_handoff', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_to_subject_id: input.toSubjectId ?? null,
      p_payload: input.payload,
    });
    if (error) throw error;
    return data;
  }

  async search(input: {
    subjectId: string;
    query: string;
    projectId?: string;
    includeHistory?: boolean;
  }) {
    const { data, error } = await this.client.rpc('api_search_memories', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_query: input.query,
      p_project_id: input.projectId ?? null,
      p_include_history: input.includeHistory ?? false,
    });
    if (error) throw error;
    return data;
  }

  async rlsProbe(input: {
    subjectId: string;
    projectId: string;
    sensitivity?: string;
  }) {
    const { data, error } = await this.client.rpc('api_rls_probe', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_project_id: input.projectId,
      p_sensitivity: input.sensitivity ?? 'internal',
    });
    if (error) throw error;
    return data;
  }

  async upsertProjectState(input: {
    subjectId: string;
    workspaceId: string;
    projectId: string;
    expectedVersion: number;
    state: Record<string, unknown>;
    summary?: string;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_project_state', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_expected_version: input.expectedVersion,
      p_state: input.state,
      p_summary: input.summary ?? null,
    });
    if (error) throw error;
    return data;
  }

  async listConnections(subjectId: string, workspaceId: string) {
    const { data, error } = await this.client.rpc('api_list_connections', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data;
  }

  async resolveSubject(input: {
    workspaceId: string;
    subjectId?: string | null;
    actorKey?: string | null;
    clientId?: string | null;
    authUserId?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_resolve_subject', {
      p_secret: this.apiSecret,
      p_workspace_id: input.workspaceId,
      p_subject_id: input.subjectId ?? null,
      p_actor_key: input.actorKey ?? null,
      p_client_id: input.clientId ?? null,
      p_auth_user_id: input.authUserId ?? null,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      kind: string;
      externalKey: string;
      displayName: string;
    };
  }

  async oauthStart(input: {
    subjectId: string;
    workspaceId: string;
    connectorId: string;
    displayName: string;
    scopes?: string[];
    redirectUri?: string;
    authorizeBase?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_oauth_start', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_connector_id: input.connectorId,
      p_display_name: input.displayName,
      p_scopes: input.scopes ?? [],
      p_redirect_uri: input.redirectUri ?? null,
      p_authorize_base: input.authorizeBase ?? null,
    });
    if (error) throw error;
    return data;
  }

  async oauthCompleteStub(input: {
    subjectId: string;
    state: string;
    code?: string;
    env?: string;
  }) {
    const { data, error } = await this.client.rpc('api_oauth_complete_stub', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_state: input.state,
      p_code: input.code ?? null,
      p_env: input.env ?? process.env.MEMORY_OS_ENV ?? 'local',
    });
    if (error) throw error;
    return data;
  }

  async bindAuthUser(input: {
    workspaceId: string;
    authUserId: string;
    email?: string;
    displayName?: string;
    actingSubjectId?: string;
  }) {
    const { data, error } = await this.client.rpc('api_bind_auth_user', {
      p_secret: this.apiSecret,
      p_workspace_id: input.workspaceId,
      p_auth_user_id: input.authUserId,
      p_email: input.email ?? null,
      p_display_name: input.displayName ?? null,
      p_acting_subject_id: input.actingSubjectId ?? null,
    });
    if (error) throw error;
    return data;
  }

  async upsertConnection(input: {
    subjectId: string;
    workspaceId: string;
    connectorId: string;
    displayName: string;
    scopes?: string[];
    status?: string;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_connection', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_connector_id: input.connectorId,
      p_display_name: input.displayName,
      p_scopes: input.scopes ?? [],
      p_status: input.status ?? 'connected',
    });
    if (error) throw error;
    return data;
  }

  async setConnectionStatus(input: {
    subjectId: string;
    connectionId: string;
    status: string;
    lastError?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_set_connection_status', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_status: input.status,
      p_last_error: input.lastError ?? null,
    });
    if (error) throw error;
    return data;
  }

  async captureText(input: {
    subjectId: string;
    workspaceId: string;
    projectId: string;
    title: string;
    text: string;
    idempotencyKey: string;
    sensitivity?: string;
    processNow?: boolean;
    filename?: string;
    mimeType?: string;
  }) {
    const { data, error } = await this.client.rpc('api_capture_text', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_title: input.title,
      p_text: input.text,
      p_idempotency_key: input.idempotencyKey,
      p_sensitivity: input.sensitivity ?? 'internal',
      p_process_now: input.processNow ?? true,
      p_filename: input.filename ?? null,
      p_mime_type: input.mimeType ?? 'text/plain',
    });
    if (error) throw error;
    return data;
  }

  async processIngestJob(subjectId: string, jobId: string) {
    const { data, error } = await this.client.rpc('api_process_ingest_job', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_job_id: jobId,
    });
    if (error) throw error;
    return data;
  }

  async getJob(subjectId: string, jobId: string) {
    const { data, error } = await this.client.rpc('api_get_job', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_job_id: jobId,
    });
    if (error) throw error;
    return data;
  }
}

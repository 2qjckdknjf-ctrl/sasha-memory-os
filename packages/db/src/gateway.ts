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
    queryEmbedding?: number[] | null;
  }) {
    const { data, error } = await this.client.rpc('api_search_memories', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_query: input.query,
      p_project_id: input.projectId ?? null,
      p_include_history: input.includeHistory ?? false,
      p_query_embedding: input.queryEmbedding ?? null,
    });
    if (error) throw error;
    return data;
  }

  async listMemories(input: {
    subjectId: string;
    workspaceId: string;
    projectId?: string | null;
    status?: string | null;
    limit?: number;
  }) {
    const { data, error } = await this.client.rpc('api_list_memories', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId ?? null,
      p_status: input.status ?? null,
      p_limit: input.limit ?? 50,
    });
    if (error) throw error;
    return data as Array<{
      id: string;
      title: string;
      content: string;
      status: string;
      sensitivity: string;
      memoryType: string;
      projectId: string | null;
      recordedAt: string;
      metadata: Record<string, unknown>;
      embedding?: number[] | null;
      embeddingEngine?: string | null;
      embeddingDims?: number | null;
    }>;
  }

  async getMemory(input: { subjectId: string; memoryId: string }) {
    const { data, error } = await this.client.rpc('api_get_memory', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_memory_id: input.memoryId,
    });
    if (error) throw error;
    return data as {
      id: string;
      title: string;
      content: string;
      status: string;
      sensitivity: string;
      memoryType: string;
      projectId: string | null;
      workspaceId: string;
      recordedAt: string;
      metadata: Record<string, unknown>;
      embedding?: number[] | null;
      embeddingEngine?: string | null;
      embeddingDims?: number | null;
    };
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

  async oauthPeekState(input: { subjectId: string; state: string }) {
    const { data, error } = await this.client.rpc('api_oauth_peek_state', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_state: input.state,
    });
    if (error) throw error;
    return data as {
      state: string;
      workspaceId: string;
      connectorId: string;
      connectionId: string;
      redirectUri: string | null;
      scopes: string[];
      expiresAt: string;
    };
  }

  async oauthCompleteStub(input: {
    subjectId: string;
    state: string;
    /** Prefer fingerprint — raw code must not be persisted. */
    codeFingerprint?: string | null;
    exchangeMode?: 'stub' | 'credentials_ready' | 'exchanged';
    env?: string;
  }) {
    const { data, error } = await this.client.rpc('api_oauth_complete_stub', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_state: input.state,
      p_code: null,
      p_env: input.env ?? process.env.MEMORY_OS_ENV ?? 'local',
      p_exchange_mode: input.exchangeMode ?? 'stub',
      p_code_fingerprint: input.codeFingerprint ?? null,
    });
    if (error) throw error;
    return data as {
      connectionId: string;
      connectorId: string;
      status: string;
      vaultRef: string;
      tokenPersisted: boolean;
      exchangeMode?: string;
      codeFingerprint?: string | null;
      tokensInVault?: boolean;
    };
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
    return data as {
      eventId?: string;
      artifactId?: string;
      jobId?: string;
      process?: { memoryId?: string | null } | null;
      [key: string]: unknown;
    };
  }

  async setMemoryEmbedding(input: {
    subjectId: string;
    memoryId: string;
    embedding: number[];
    engine?: string;
  }) {
    const { data, error } = await this.client.rpc('api_set_memory_embedding', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_memory_id: input.memoryId,
      p_embedding: input.embedding,
      p_engine: input.engine ?? 'stub-hash',
    });
    if (error) throw error;
    return data as {
      memoryId: string;
      engine: string | null;
      dims: number;
      embeddedAt: string;
      hasVector: boolean;
    };
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

  async enqueueConnectorSync(input: {
    subjectId: string;
    workspaceId: string;
    connectionId?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_enqueue_connector_sync', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_connection_id: input.connectionId ?? null,
    });
    if (error) throw error;
    return data as {
      count: number;
      enqueued: Array<{
        connectionId: string;
        connectorId: string;
        displayName?: string;
        vaultRef?: string | null;
        jobId?: string;
        eventId?: string;
        idempotencyKey?: string;
      }>;
    };
  }

  async setMemoryStatus(input: {
    subjectId: string;
    memoryId: string;
    status: string;
    reason: string;
  }) {
    const { data, error } = await this.client.rpc('api_set_memory_status', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_memory_id: input.memoryId,
      p_status: input.status,
      p_reason: input.reason,
    });
    if (error) throw error;
    return data as {
      id: string;
      status: string;
      projectId: string | null;
      title: string;
      reason: string;
    };
  }

  async supersedeMemory(input: {
    subjectId: string;
    duplicateId: string;
    keeperId: string;
    reason?: string;
  }) {
    const { data, error } = await this.client.rpc('api_supersede_memory', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_duplicate_id: input.duplicateId,
      p_keeper_id: input.keeperId,
      p_reason: input.reason ?? 'consolidation: near-duplicate candidate',
    });
    if (error) throw error;
    return data as {
      duplicateId: string;
      keeperId: string;
      status: string;
      supersededBy: string;
      reason: string;
    };
  }

  async vaultPut(input: { vaultRef: string; ciphertextBase64: string }) {
    const { data, error } = await this.client.rpc('api_vault_put', {
      p_secret: this.apiSecret,
      p_vault_ref: input.vaultRef,
      p_ciphertext: input.ciphertextBase64,
    });
    if (error) throw error;
    return data as { vaultRef: string; ok: boolean };
  }

  async vaultGet(vaultRef: string) {
    const { data, error } = await this.client.rpc('api_vault_get', {
      p_secret: this.apiSecret,
      p_vault_ref: vaultRef,
    });
    if (error) throw error;
    return data as {
      vaultRef: string;
      found: boolean;
      ciphertext?: string;
      updatedAt?: string;
    };
  }

  async vaultDelete(vaultRef: string) {
    const { data, error } = await this.client.rpc('api_vault_delete', {
      p_secret: this.apiSecret,
      p_vault_ref: vaultRef,
    });
    if (error) throw error;
    return data as { vaultRef: string; ok: boolean };
  }

  async completeConnectorSync(input: {
    subjectId: string;
    jobId: string;
    status?: 'succeeded' | 'failed' | 'dead_letter';
    error?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_complete_connector_sync', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_job_id: input.jobId,
      p_status: input.status ?? 'succeeded',
      p_error: input.error ?? null,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      status: string;
      connectionId: string | null;
      jobType: string;
    };
  }

  async enqueueConsolidation(input: {
    subjectId: string;
    workspaceId: string;
  }) {
    const { data, error } = await this.client.rpc('api_enqueue_consolidation', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      eventId: string;
      idempotencyKey: string;
      workspaceId: string;
      inserted?: boolean;
    };
  }

  async completeConsolidation(input: {
    subjectId: string;
    jobId: string;
    status?: 'succeeded' | 'failed' | 'dead_letter';
    error?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_complete_consolidation', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_job_id: input.jobId,
      p_status: input.status ?? 'succeeded',
      p_error: input.error ?? null,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      status: string;
      jobType: string;
    };
  }

  async listOutboxPending(input: {
    subjectId: string;
    workspaceId: string;
    eventType?: string | null;
    limit?: number;
  }) {
    const { data, error } = await this.client.rpc('api_list_outbox_pending', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_event_type: input.eventType ?? null,
      p_limit: input.limit ?? 50,
    });
    if (error) throw error;
    return data as {
      count: number;
      events: Array<{
        id: string;
        workspaceId: string;
        aggregateType: string;
        aggregateId: string;
        eventType: string;
        payload: Record<string, unknown>;
        createdAt: string;
        attempts: number;
        lastError: string | null;
      }>;
    };
  }

  async deadLetterStaleJobs(input: {
    subjectId: string;
    workspaceId: string;
    olderThanMinutes?: number;
  }) {
    const { data, error } = await this.client.rpc('api_dead_letter_stale_jobs', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_older_than_minutes: input.olderThanMinutes ?? 60,
    });
    if (error) throw error;
    return data as {
      deadLettered: number;
      olderThanMinutes: number;
      cutoff: string;
    };
  }

  async publishOutboxEvent(input: {
    subjectId: string;
    eventId: string;
    error?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_publish_outbox_event', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_event_id: input.eventId,
      p_error: input.error ?? null,
    });
    if (error) throw error;
    return data as {
      id: string;
      eventType: string;
      publishedAt: string;
      attempts: number;
      lastError: string | null;
    };
  }

  async vaultKmsPut(input: { vaultRef: string; plaintext: string }) {
    const { data, error } = await this.client.rpc('api_vault_kms_put', {
      p_secret: this.apiSecret,
      p_vault_ref: input.vaultRef,
      p_plaintext: input.plaintext,
    });
    if (error) throw error;
    return data as {
      ok: boolean;
      vaultRef: string;
      secretId: string;
      backend: string;
    };
  }

  async vaultKmsGet(vaultRef: string) {
    const { data, error } = await this.client.rpc('api_vault_kms_get', {
      p_secret: this.apiSecret,
      p_vault_ref: vaultRef,
    });
    if (error) throw error;
    return data as {
      found: boolean;
      vaultRef: string;
      plaintext?: string;
      backend: string;
    };
  }

  async vaultKmsDelete(vaultRef: string) {
    const { data, error } = await this.client.rpc('api_vault_kms_delete', {
      p_secret: this.apiSecret,
      p_vault_ref: vaultRef,
    });
    if (error) throw error;
    return data as {
      ok: boolean;
      vaultRef: string;
      deleted: boolean;
      backend: string;
    };
  }
}

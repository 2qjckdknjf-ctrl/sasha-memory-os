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
    projectId?: string | null;
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
      p_project_id: input.projectId ?? null,
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
    projectId?: string | null;
    toSubjectId?: string;
    payload: Record<string, unknown>;
  }) {
    const { data, error } = await this.client.rpc('api_create_handoff', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId ?? null,
      p_to_subject_id: input.toSubjectId ?? null,
      p_payload: input.payload,
    });
    if (error) throw error;
    return data;
  }

  async listHandoffs(input: {
    subjectId: string;
    workspaceId: string;
    projectId?: string | null;
    limit?: number;
  }) {
    const { data, error } = await this.client.rpc('api_list_handoffs', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId ?? null,
      p_limit: input.limit ?? 50,
    });
    if (error) throw error;
    return data as {
      handoffs: Array<{
        id: string;
        workspaceId: string;
        projectId: string | null;
        fromSubjectId: string | null;
        toSubjectId: string | null;
        sessionId: string | null;
        payload: Record<string, unknown>;
        createdAt: string;
      }>;
    };
  }

  async search(input: {
    subjectId: string;
    query: string;
    projectId?: string;
    includeHistory?: boolean;
    queryEmbedding?: number[] | null;
    recordedAfter?: string | null;
    recordedBefore?: string | null;
  }) {
    // Omit temporal args when unset (keeps PostgREST overload matching simple).
    const args: Record<string, unknown> = {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_query: input.query,
      p_project_id: input.projectId ?? null,
      p_include_history: input.includeHistory ?? false,
      p_query_embedding: input.queryEmbedding ?? null,
    };
    if (input.recordedAfter) args.p_recorded_after = input.recordedAfter;
    if (input.recordedBefore) args.p_recorded_before = input.recordedBefore;
    const { data, error } = await this.client.rpc('api_search_memories', args);
    if (error) throw error;
    return data;
  }

  async listMemories(input: {
    subjectId: string;
    workspaceId: string;
    projectId?: string | null;
    status?: string | null;
    limit?: number;
    recordedAfter?: string | null;
    recordedBefore?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_list_memories', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId ?? null,
      p_status: input.status ?? null,
      p_limit: input.limit ?? 50,
      p_recorded_after: input.recordedAfter ?? null,
      p_recorded_before: input.recordedBefore ?? null,
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
      observedAt?: string | null;
      validFrom?: string | null;
      validTo?: string | null;
      sourceEventId?: string | null;
      createdBySubject?: string | null;
      supersededBy?: string | null;
      importance?: number | null;
      confidence?: number | null;
      schemaVersion?: string | null;
      source?: Record<string, unknown> | null;
      evidence?: Array<Record<string, unknown>> | null;
      provenance?: Record<string, unknown> | null;
      metadata: Record<string, unknown>;
      embedding?: number[] | null;
      embeddingEngine?: string | null;
      embeddingDims?: number | null;
    };
  }

  async listAudit(input: {
    subjectId: string;
    workspaceId: string;
    limit?: number;
  }) {
    const { data, error } = await this.client.rpc('api_list_audit', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_limit: input.limit ?? 50,
    });
    if (error) throw error;
    return data as {
      events: Array<{
        id: string;
        workspaceId: string;
        actorSubjectId: string | null;
        actor?: {
          id: string;
          externalKey?: string | null;
          displayName?: string | null;
          kind?: string | null;
        } | null;
        action: string;
        objectType: string | null;
        objectId: string | null;
        reason: string | null;
        beforeState: Record<string, unknown> | null;
        afterState: Record<string, unknown> | null;
        recordedAt: string;
      }>;
    };
  }

  async appendAuditEvent(input: {
    subjectId: string;
    workspaceId: string;
    action: string;
    objectType?: string | null;
    objectId?: string | null;
    reason?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
  }) {
    const { data, error } = await this.client.rpc('api_append_audit_event', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_action: input.action,
      p_object_type: input.objectType ?? null,
      p_object_id: input.objectId ?? null,
      p_reason: input.reason ?? null,
      p_before_state: input.beforeState ?? null,
      p_after_state: input.afterState ?? null,
    });
    if (error) throw error;
    return data as {
      id: string;
      action: string;
      objectType: string | null;
      objectId: string | null;
      reason: string | null;
      recordedAt: string;
    };
  }

  async createPrivacyRequest(input: {
    subjectId: string;
    workspaceId: string;
    projectId?: string | null;
    requestType: 'deletion' | 'correction' | 'retraction';
    targetMemoryId?: string | null;
    reason: string;
    correctionText?: string | null;
    idempotencyKey: string;
  }) {
    const { data, error } = await this.client.rpc('api_create_privacy_request', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId ?? null,
      p_request_type: input.requestType,
      p_target_memory_id: input.targetMemoryId ?? null,
      p_reason: input.reason,
      p_correction_text: input.correctionText ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      projectId: string | null;
      actorSubjectId: string | null;
      requestType: 'deletion' | 'correction' | 'retraction';
      status: 'submitted';
      targetMemoryId: string | null;
      reason: string;
      correctionText: string | null;
      createdAt: string;
      actor?: {
        id: string;
        externalKey?: string | null;
        displayName?: string | null;
        kind?: string | null;
      } | null;
    };
  }

  async listPrivacyRequests(input: {
    subjectId: string;
    workspaceId: string;
    limit?: number;
  }) {
    const { data, error } = await this.client.rpc('api_list_privacy_requests', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_limit: input.limit ?? 50,
    });
    if (error) throw error;
    return data as {
      requests: Array<{
        id: string;
        workspaceId: string;
        projectId: string | null;
        actorSubjectId: string | null;
        requestType: 'deletion' | 'correction' | 'retraction';
        status: 'submitted';
        targetMemoryId: string | null;
        reason: string;
        correctionText: string | null;
        createdAt: string;
        actor?: {
          id: string;
          externalKey?: string | null;
          displayName?: string | null;
          kind?: string | null;
        } | null;
      }>;
    };
  }

  async getAgentRights(input: { subjectId: string; workspaceId: string }) {
    const { data, error } = await this.client.rpc('api_list_agent_rights', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
    });
    if (error) throw error;
    return data as {
      currentActor: {
        subjectId: string;
        isOwner: boolean;
        actor: {
          id: string;
          externalKey?: string | null;
          displayName?: string | null;
          kind?: string | null;
        };
      };
      actors: Array<{
        subjectId: string;
        externalKey: string | null;
        displayName: string | null;
        kind: string | null;
        isOwner: boolean;
        purpose?: string | null;
        allowedTools?: string[] | null;
        scopes: string[];
        capabilities: string[];
        rights: Array<{
          effect: string;
          resourceType: string;
          projectId: string | null;
          actions: string[];
          sensitivityMax: string | null;
          source: string;
        }>;
      }>;
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
    return data as Array<{
      id: string;
      workspaceId?: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
      definition?: {
        id: string;
        version?: string;
        displayName: string;
        authType?: string;
        capabilities: string[];
        supports?: Record<string, unknown>;
        storageModes?: string[];
      };
    }>;
  }

  async listProjects(subjectId: string, workspaceId: string) {
    const { data, error } = await this.client.rpc('api_list_projects', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data as Array<{
      id: string;
      slug: string;
      name: string;
      status: string;
      url?: string | null;
    }>;
  }

  async listProjectHints(subjectId: string, workspaceId: string) {
    const { data, error } = await this.client.rpc('api_list_project_hints', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_workspace_id: workspaceId,
    });
    if (error) throw error;
    return data as Array<{
      id: string;
      slug: string;
      name: string;
      status: string;
      url?: string | null;
    }>;
  }

  async resolveProjectRef(input: {
    subjectId: string;
    workspaceId: string;
    projectRef?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_resolve_project_ref', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_ref: input.projectRef ?? null,
    });
    if (error) throw error;
    return data as {
      projectId: string | null;
      matchCount: number;
      candidates: Array<{
        id: string;
        slug: string;
        name: string;
        url?: string | null;
      }>;
    };
  }

  async listConnectors(subjectId: string) {
    const { data, error } = await this.client.rpc('api_list_connectors', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
    });
    if (error) throw error;
    return data as Array<{
      id: string;
      version: string;
      displayName: string;
      authType: string;
      capabilities: string[];
      supports: Record<string, unknown>;
      storageModes: string[];
    }>;
  }

  async getConnection(subjectId: string, connectionId: string) {
    const { data, error } = await this.client.rpc('api_get_connection', {
      p_secret: this.apiSecret,
      p_subject_id: subjectId,
      p_connection_id: connectionId,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
      definition?: {
        id: string;
        version: string;
        displayName: string;
        authType: string;
        capabilities: string[];
        supports: Record<string, unknown>;
        storageModes: string[];
      };
    };
  }

  async upsertProjectFromConnector(input: {
    subjectId: string;
    workspaceId: string;
    provider: string;
    connectionId: string;
    collectionId: string;
    externalId?: string | null;
    name?: string | null;
    url?: string | null;
    description?: string | null;
    defaultBranch?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_project_from_connector', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_provider: input.provider,
      p_connection_id: input.connectionId,
      p_collection_id: input.collectionId,
      p_external_id: input.externalId ?? null,
      p_name: input.name ?? null,
      p_url: input.url ?? null,
      p_description: input.description ?? null,
      p_default_branch: input.defaultBranch ?? null,
      p_metadata: input.metadata ?? {},
    });
    if (error) throw error;
    return data as {
      projectId: string;
      slug: string;
      name: string;
      memoryId: string;
      collectionId: string;
    };
  }

  async getConnectorCursor(input: {
    subjectId: string;
    accountId: string;
    stream: string;
  }) {
    const { data, error } = await this.client.rpc('api_get_connector_cursor', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_account_id: input.accountId,
      p_stream: input.stream,
    });
    if (error) throw error;
    return (data as
      | {
          accountId: string;
          stream: string;
          cursor: Record<string, unknown>;
          schemaVersion: string;
          updatedAt: string;
        }
      | null);
  }

  async upsertConnectorCursor(input: {
    subjectId: string;
    accountId: string;
    stream: string;
    cursor: Record<string, unknown>;
    schemaVersion?: string;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_connector_cursor', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_account_id: input.accountId,
      p_stream: input.stream,
      p_cursor: input.cursor,
      p_schema_version: input.schemaVersion ?? '1.0',
    });
    if (error) throw error;
    return data as {
      accountId: string;
      stream: string;
      cursor: Record<string, unknown>;
      schemaVersion: string;
      updatedAt: string;
    };
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
    metadata?: Record<string, unknown>;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_connection', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_connector_id: input.connectorId,
      p_display_name: input.displayName,
      p_scopes: input.scopes ?? [],
      p_status: input.status ?? 'connected',
      p_metadata: input.metadata ?? null,
    });
    if (error) throw error;
    return data;
  }

  async setConnectionMetadata(input: {
    subjectId: string;
    connectionId: string;
    metadata: Record<string, unknown>;
  }) {
    const { data, error } = await this.client.rpc('api_set_connection_metadata', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_metadata: input.metadata,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
    };
  }

  async upsertConnectionCollectionItem(input: {
    subjectId: string;
    connectionId: string;
    item: unknown;
    projectBindings?: Record<string, string>;
    discoveredAt?: string;
  }) {
    const { data, error } = await this.client.rpc('api_upsert_connection_collection_item', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_item: input.item,
      p_project_bindings: input.projectBindings ?? {},
      p_discovered_at: input.discoveredAt ?? null,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
    };
  }

  async mergeConnectionProjectBindings(input: {
    subjectId: string;
    connectionId: string;
    projectBindings: Record<string, string>;
  }) {
    const { data, error } = await this.client.rpc('api_merge_connection_project_bindings', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_project_bindings: input.projectBindings,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
    };
  }

  async refreshConnectionCollections(input: {
    subjectId: string;
    connectionId: string;
    items: unknown[];
    projectBindings?: Record<string, string>;
    discoveredAt?: string;
  }) {
    const { data, error } = await this.client.rpc('api_refresh_connection_collections', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_items: input.items,
      p_project_bindings: input.projectBindings ?? {},
      p_discovered_at: input.discoveredAt ?? new Date().toISOString(),
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
    };
  }

  async setConnectionCollectionExclusions(input: {
    subjectId: string;
    connectionId: string;
    excludedIds: string[];
  }) {
    const { data, error } = await this.client.rpc('api_set_connection_collection_exclusions', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_connection_id: input.connectionId,
      p_excluded_ids: input.excludedIds,
    });
    if (error) throw error;
    return data as {
      id: string;
      workspaceId: string;
      connectorId: string;
      displayName: string;
      status: string;
      scopes: string[];
      lastSyncAt: string | null;
      lastError: string | null;
      vaultRef?: string | null;
      metadata?: Record<string, unknown>;
    };
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
    projectId?: string | null;
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
      p_project_id: input.projectId ?? null,
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

  async captureConnectorRecord(input: {
    subjectId: string;
    workspaceId: string;
    projectId: string;
    provider: string;
    accountId?: string | null;
    externalId: string;
    externalVersion?: string | null;
    eventType: string;
    title: string;
    text: string;
    idempotencyKey: string;
    sensitivity?: string;
    storageMode?: string;
    observedAt?: string;
    filename?: string;
    mimeType?: string;
    canonicalReference?: string | null;
    provenance?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    processNow?: boolean;
  }) {
    const { data, error } = await this.client.rpc('api_capture_connector_record', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_project_id: input.projectId,
      p_provider: input.provider,
      p_account_id: input.accountId ?? null,
      p_external_id: input.externalId,
      p_external_version: input.externalVersion ?? null,
      p_event_type: input.eventType,
      p_title: input.title,
      p_text: input.text,
      p_idempotency_key: input.idempotencyKey,
      p_sensitivity: input.sensitivity ?? 'internal',
      p_storage_mode: input.storageMode ?? 'reference',
      p_observed_at: input.observedAt ?? new Date().toISOString(),
      p_filename: input.filename ?? null,
      p_mime_type: input.mimeType ?? 'text/plain',
      p_canonical_reference: input.canonicalReference ?? null,
      p_provenance: input.provenance ?? {},
      p_metadata: input.metadata ?? {},
      p_process_now: input.processNow ?? true,
    });
    if (error) throw error;
    return data as {
      eventId?: string;
      artifactId?: string;
      jobId?: string;
      checksum?: string;
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

  async claimConnectorSyncJobs(input: {
    subjectId: string;
    workspaceId: string;
    limit?: number;
    connectionId?: string | null;
    retryBaseMs?: number;
    retryMaxMs?: number;
  }) {
    const { data, error } = await this.client.rpc('api_claim_connector_sync_jobs', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_limit: input.limit ?? 20,
      p_connection_id: input.connectionId ?? null,
      p_retry_base_ms: input.retryBaseMs ?? 30_000,
      p_retry_max_ms: input.retryMaxMs ?? 300_000,
    });
    if (error) throw error;
    return data as {
      count: number;
      jobs: Array<{
        jobId: string;
        workspaceId: string;
        status: string;
        attempt: number;
        error: string | null;
        idempotencyKey: string;
        connectionId: string;
        connectorId: string;
        displayName?: string | null;
        vaultRef?: string | null;
      }>;
    };
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

  async correctMemory(input: {
    subjectId: string;
    memoryId: string;
    reason: string;
    title?: string;
    content?: string;
    replacementMemoryId?: string;
  }) {
    const { data, error } = await this.client.rpc('api_correct_memory', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_memory_id: input.memoryId,
      p_reason: input.reason,
      p_title: input.title ?? null,
      p_content: input.content ?? null,
      p_replacement_memory_id: input.replacementMemoryId ?? null,
    });
    if (error) throw error;
    return data as {
      supersededId: string;
      authoritativeId: string;
      supersededStatus: string;
      authoritativeStatus: string;
      reason: string;
      projectId: string | null;
      title: string;
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
      attempt?: number;
    };
  }

  async retryConnectorSync(input: {
    subjectId: string;
    jobId: string;
    error?: string | null;
  }) {
    const { data, error } = await this.client.rpc('api_retry_connector_sync', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_job_id: input.jobId,
      p_error: input.error ?? null,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      status: string;
      attempt: number;
      connectionId: string | null;
      jobType: string;
      error: string | null;
    };
  }

  async replayConnectorSync(input: {
    subjectId: string;
    jobId: string;
    resync?: boolean;
  }) {
    const { data, error } = await this.client.rpc('api_replay_connector_sync', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_job_id: input.jobId,
      p_resync: input.resync ?? false,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      status: string;
      attempt: number;
      connectionId: string | null;
      jobType: string;
      resync: boolean;
      clearedCursorCount: number;
    };
  }

  async resyncConnector(input: {
    subjectId: string;
    workspaceId: string;
    connectionId: string;
  }) {
    const { data, error } = await this.client.rpc('api_resync_connector', {
      p_secret: this.apiSecret,
      p_subject_id: input.subjectId,
      p_workspace_id: input.workspaceId,
      p_connection_id: input.connectionId,
    });
    if (error) throw error;
    return data as {
      jobId: string;
      eventId: string;
      connectionId: string;
      connectorId: string;
      clearedCursorCount: number;
      idempotencyKey: string;
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

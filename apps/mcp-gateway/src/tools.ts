import {
  createSeededStore,
  type MemoryStore,
} from '@memory-os/domain';
import type { SupabaseMemoryGateway } from '@memory-os/db';
import { projectContext, searchMemories } from '@memory-os/retrieval';
import {
  captureTextSchema,
  createDecisionSchema,
  createHandoffSchema,
  setConnectionStatusSchema,
  upsertConnectionSchema,
} from '@memory-os/schemas';

export const packageName = 'mcp-gateway' as const;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const mcpTools: McpTool[] = [
  {
    name: 'memory.search',
    description: 'Hybrid/structured search over allowed memories',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project_id: { type: 'string' },
        include_history: { type: 'boolean' },
        actor_subject_id: { type: 'string' },
      },
      required: ['query', 'actor_subject_id'],
    },
  },
  {
    name: 'context.project',
    description: 'Current project context: decisions, tasks, facts',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['project_id', 'actor_subject_id'],
    },
  },
  {
    name: 'memory.store_decision',
    description: 'Store a verified decision with idempotency',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: [
        'workspace_id',
        'project_id',
        'title',
        'content',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
  {
    name: 'handoff.create',
    description: 'Create agent handoff for a project',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        from_subject_id: { type: 'string' },
        to_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        payload: { type: 'object' },
      },
      required: [
        'workspace_id',
        'project_id',
        'from_subject_id',
        'idempotency_key',
        'payload',
      ],
    },
  },
  {
    name: 'connections.list',
    description: 'List connector accounts and health for a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
  {
    name: 'connections.upsert',
    description: 'Connect or refresh a connector account (OAuth stub)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        connector_id: { type: 'string' },
        display_name: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' } },
        status: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: [
        'workspace_id',
        'connector_id',
        'display_name',
        'actor_subject_id',
      ],
    },
  },
  {
    name: 'connections.set_status',
    description: 'Revoke, reauth, or mark a connection degraded',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string' },
        status: { type: 'string' },
        last_error: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['connection_id', 'status', 'actor_subject_id'],
    },
  },
  {
    name: 'capture.text',
    description: 'Capture plain text into quarantine → candidate memory',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        project_id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        actor_subject_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        process_now: { type: 'boolean' },
      },
      required: [
        'workspace_id',
        'project_id',
        'title',
        'text',
        'actor_subject_id',
        'idempotency_key',
      ],
    },
  },
  {
    name: 'connections.sync',
    description: 'Enqueue connector_sync jobs for connected accounts (stub)',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        connection_id: { type: 'string' },
        actor_subject_id: { type: 'string' },
      },
      required: ['workspace_id', 'actor_subject_id'],
    },
  },
];

export function createMcpHandlers(options?: {
  store?: MemoryStore;
  gateway?: SupabaseMemoryGateway | null;
}) {
  const store = options?.store ?? createSeededStore();
  const gateway = options?.gateway ?? null;

  return {
    tools: mcpTools,
    backend: gateway ? ('supabase' as const) : ('memory-store' as const),
    async call(name: string, args: Record<string, unknown>) {
      switch (name) {
        case 'memory.search': {
          if (gateway) {
            const hits = await gateway.search({
              subjectId: String(args.actor_subject_id),
              query: String(args.query ?? ''),
              projectId: args.project_id ? String(args.project_id) : undefined,
              includeHistory: Boolean(args.include_history),
            });
            return { hits };
          }
          return {
            hits: searchMemories([...store.memories.values()], String(args.query ?? ''), {
              projectId: args.project_id ? String(args.project_id) : undefined,
              includeHistory: Boolean(args.include_history),
            }),
          };
        }
        case 'context.project': {
          const projectId = String(args.project_id);
          if (gateway) {
            return gateway.projectContext(String(args.actor_subject_id), projectId);
          }
          return {
            ...projectContext([...store.memories.values()], projectId),
            state: store.getProjectState(projectId),
            latest_handoff: store.latestHandoff(projectId),
          };
        }
        case 'memory.store_decision': {
          const input = createDecisionSchema.parse(args);
          if (gateway) {
            return gateway.createDecision({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              content: input.content,
              idempotencyKey: input.idempotency_key,
              importance: input.importance,
              confidence: input.confidence,
              sensitivity: input.sensitivity,
            });
          }
          return store.createDecision({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: input.title,
            content: input.content,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey: input.idempotency_key,
            importance: input.importance,
            confidence: input.confidence,
            sensitivity: input.sensitivity,
          });
        }
        case 'handoff.create': {
          const input = createHandoffSchema.parse(args);
          if (gateway) {
            return gateway.createHandoff({
              subjectId: input.from_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              toSubjectId: input.to_subject_id,
              payload: input.payload,
            });
          }
          return store.createHandoff({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            fromSubjectId: input.from_subject_id,
            toSubjectId: input.to_subject_id,
            sessionId: input.session_id,
            payload: input.payload,
          });
        }
        case 'connections.list': {
          if (!gateway) {
            return {
              connections: [
                {
                  connectorId: 'github',
                  displayName: 'AISTROYKA repos',
                  status: 'connected',
                },
              ],
            };
          }
          return {
            connections: await gateway.listConnections(
              String(args.actor_subject_id),
              String(args.workspace_id),
            ),
          };
        }
        case 'connections.upsert': {
          const input = upsertConnectionSchema.parse(args);
          if (!gateway) {
            return {
              id: crypto.randomUUID(),
              connectorId: input.connector_id,
              displayName: input.display_name,
              status: input.status,
              scopes: input.scopes,
            };
          }
          return gateway.upsertConnection({
            subjectId: input.actor_subject_id,
            workspaceId: input.workspace_id,
            connectorId: input.connector_id,
            displayName: input.display_name,
            scopes: input.scopes,
            status: input.status,
          });
        }
        case 'connections.set_status': {
          const input = setConnectionStatusSchema.parse({
            status: args.status,
            last_error: args.last_error,
            actor_subject_id: args.actor_subject_id,
          });
          if (!gateway) {
            return {
              id: String(args.connection_id),
              status: input.status,
              lastError: input.last_error ?? null,
            };
          }
          return gateway.setConnectionStatus({
            subjectId: input.actor_subject_id,
            connectionId: String(args.connection_id),
            status: input.status,
            lastError: input.last_error,
          });
        }
        case 'capture.text': {
          const input = captureTextSchema.parse(args);
          if (gateway) {
            return gateway.captureText({
              subjectId: input.actor_subject_id,
              workspaceId: input.workspace_id,
              projectId: input.project_id,
              title: input.title,
              text: input.text,
              idempotencyKey: input.idempotency_key,
              sensitivity: input.sensitivity,
              processNow: input.process_now,
            });
          }
          return store.captureText({
            workspaceId: input.workspace_id,
            projectId: input.project_id,
            title: input.title,
            text: input.text,
            actorSubjectId: input.actor_subject_id,
            idempotencyKey: input.idempotency_key,
            sensitivity: input.sensitivity,
          });
        }
        case 'connections.sync': {
          if (!gateway) {
            return {
              count: 0,
              enqueued: [],
              backend: 'memory-store',
              note: 'connector sync requires supabase backend',
            };
          }
          return gateway.enqueueConnectorSync({
            subjectId: String(args.actor_subject_id),
            workspaceId: String(args.workspace_id),
            connectionId: args.connection_id
              ? String(args.connection_id)
              : null,
          });
        }
        default: {
          const _exhaustive: never = name as never;
          throw new Error(`Unknown tool: ${_exhaustive}`);
        }
      }
    },
  };
}

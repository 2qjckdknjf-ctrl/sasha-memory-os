import {
  createSeededStore,
  type MemoryStore,
} from '@memory-os/domain';
import type { SupabaseMemoryGateway } from '@memory-os/db';
import { projectContext, searchMemories } from '@memory-os/retrieval';
import { createDecisionSchema, createHandoffSchema } from '@memory-os/schemas';

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
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    },
  };
}

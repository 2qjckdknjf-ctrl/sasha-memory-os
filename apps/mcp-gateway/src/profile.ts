/**
 * MCP exposure profiles for Cursor (full) vs ChatGPT remote A (pilot).
 * See docs/m0/CHATGPT_MCP_PLAN.md.
 */

export type McpProfileName = 'full' | 'chatgpt';

export const CHATGPT_SUBJECT_ID =
  '33333333-3333-4333-8333-333333333302';
export const DEFAULT_WORKSPACE_ID =
  '11111111-1111-4111-8111-111111111111';
export const DEFAULT_PROJECT_ID =
  '44444444-4444-4444-8444-444444444401';

/** ChatGPT pilot tool set (read + write when workspace allows). */
export const CHATGPT_PILOT_TOOLS = [
  'memory.search',
  'memory.get',
  'context.project',
  'capture.text',
  'memory.store_decision',
  'handoff.create',
  'memory.set_status',
] as const;

export type ChatgptPilotTool = (typeof CHATGPT_PILOT_TOOLS)[number];

const READ_ONLY_TOOLS = new Set<string>([
  'memory.search',
  'memory.get',
  'context.project',
  'memory.export',
  'jobs.get',
  'outbox.list_pending',
  'extraction.preview',
]);

export type McpProfile = {
  name: McpProfileName;
  /** When set, only these tools are listed/callable. */
  allowedTools: readonly string[] | null;
  defaults: {
    actorSubjectId: string;
    workspaceId: string;
  };
  instructions: string;
};

export function resolveMcpProfileName(
  raw?: string | null,
): McpProfileName {
  const value = (raw ?? process.env.MEMORY_OS_MCP_PROFILE ?? 'full')
    .trim()
    .toLowerCase();
  if (value === 'chatgpt' || value === 'chatgpt-pilot' || value === 'a') {
    return 'chatgpt';
  }
  return 'full';
}

export function getMcpProfile(name?: McpProfileName | string | null): McpProfile {
  const resolved = resolveMcpProfileName(
    typeof name === 'string' ? name : null,
  );
  if (resolved === 'chatgpt') {
    return {
      name: 'chatgpt',
      allowedTools: CHATGPT_PILOT_TOOLS,
      defaults: {
        actorSubjectId:
          process.env.MEMORY_OS_CHATGPT_SUBJECT_ID?.trim() ||
          CHATGPT_SUBJECT_ID,
        workspaceId:
          process.env.MEMORY_OS_DEFAULT_WORKSPACE_ID?.trim() ||
          DEFAULT_WORKSPACE_ID,
      },
      instructions: [
        'Sasha Memory OS ChatGPT pilot. Prefer memory.search (pack_context=true) then context.project before writing.',
        'Writes: capture.text for notes/facts; memory.store_decision for decisions; memory.set_status for review.',
        'Defaults fill actor_subject_id / workspace_id when omitted; writes require an explicit project_id (UUID or slug from /projects or context.project).',
        'Do not invent owner/ops tools (oauth, outbox, consolidation, embed).',
      ].join(' '),
    };
  }
  return {
    name: 'full',
    allowedTools: null,
    defaults: {
      actorSubjectId:
        process.env.MEMORY_OS_DEFAULT_SUBJECT_ID?.trim() ||
        CHATGPT_SUBJECT_ID,
      workspaceId:
        process.env.MEMORY_OS_DEFAULT_WORKSPACE_ID?.trim() ||
        DEFAULT_WORKSPACE_ID,
    },
    instructions: [
      'Sasha Memory OS MCP gateway (full tool surface).',
      'Pass actor_subject_id for ACL. Owner ops require appropriate subject + API secret on HTTP.',
    ].join(' '),
  };
}

export function isToolAllowed(
  profile: McpProfile,
  toolName: string,
): boolean {
  if (!profile.allowedTools) return true;
  return profile.allowedTools.includes(toolName);
}

export function applyProfileDefaults(
  profile: McpProfile,
  args: Record<string, unknown>,
  _toolName?: string,
): Record<string, unknown> {
  const next = { ...args };
  if (
    next.actor_subject_id === undefined ||
    next.actor_subject_id === null ||
    String(next.actor_subject_id).trim() === ''
  ) {
    next.actor_subject_id = profile.defaults.actorSubjectId;
  }
  if (
    next.workspace_id === undefined ||
    next.workspace_id === null ||
    String(next.workspace_id).trim() === ''
  ) {
    next.workspace_id = profile.defaults.workspaceId;
  }
  return next;
}

export function toolAnnotations(toolName: string): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
} {
  const readOnly = READ_ONLY_TOOLS.has(toolName);
  return {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly,
    openWorldHint: false,
  };
}

/** Soften required UUID fields for ChatGPT pilot listing. */
export function adaptToolSchemaForProfile(
  profile: McpProfile,
  inputSchema: Record<string, unknown>,
): Record<string, unknown> {
  if (profile.name !== 'chatgpt') return inputSchema;
  const required = Array.isArray(inputSchema.required)
    ? (inputSchema.required as string[]).filter(
        (key) =>
          key !== 'actor_subject_id' &&
          key !== 'workspace_id',
      )
    : inputSchema.required;
  return {
    ...inputSchema,
    required,
  };
}

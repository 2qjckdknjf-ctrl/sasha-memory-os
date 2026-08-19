export const EDGE_INSTRUCTIONS = [
  "Sasha Memory OS ChatGPT pilot. Prefer memory.search (pack_context=true) then context.project before writing.",
  "Writes: capture.text for notes/facts; memory.store_decision for decisions; memory.set_status for review.",
  "Defaults fill actor_subject_id / workspace_id when omitted; writes require an explicit project_id (UUID or slug from /projects or context.project).",
  "Do not invent owner/ops tools (oauth, outbox, consolidation, embed).",
].join(" ");

export type EdgeToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const EDGE_TOOL_DEFS: EdgeToolDef[] = [
  {
    name: "memory.search",
    description:
      "Hybrid RRF search over allowed memories (optional temporal window + packed context)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        project_id: { type: "string" },
        include_history: { type: "boolean" },
        recorded_after: { type: "string" },
        recorded_before: { type: "string" },
        pack_context: { type: "boolean" },
        max_context_chars: { type: "number" },
        actor_subject_id: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "context.project",
    description: "Current project context: decisions, tasks, facts",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string" },
        actor_subject_id: { type: "string" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "memory.store_decision",
    description: "Store a verified decision with idempotency",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        project_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        actor_subject_id: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["project_id", "title", "content", "idempotency_key"],
    },
  },
  {
    name: "handoff.create",
    description: "Create agent handoff for a project",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        project_id: { type: "string" },
        from_subject_id: { type: "string" },
        to_subject_id: { type: "string" },
        idempotency_key: { type: "string" },
        payload: { type: "object" },
      },
      required: ["project_id", "from_subject_id", "idempotency_key", "payload"],
    },
  },
  {
    name: "capture.text",
    description: "Capture plain text into quarantine → candidate memory",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        project_id: { type: "string" },
        title: { type: "string" },
        text: { type: "string" },
        actor_subject_id: { type: "string" },
        idempotency_key: { type: "string" },
        process_now: { type: "boolean" },
      },
      required: ["project_id", "title", "text", "idempotency_key"],
    },
  },
  {
    name: "memory.set_status",
    description: "Approve/reject/retract/dispute a memory (owner or dispute)",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        status: { type: "string" },
        reason: { type: "string" },
        actor_subject_id: { type: "string" },
      },
      required: ["memory_id", "status", "reason"],
    },
  },
  {
    name: "memory.get",
    description: "Fetch a single memory with full content (ACL-aware)",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
        actor_subject_id: { type: "string" },
      },
      required: ["memory_id"],
    },
  },
];

export function applyEdgeDefaults(
  raw: Record<string, unknown>,
  defaults: { subjectId: string; workspaceId: string },
): Record<string, unknown> {
  return {
    ...raw,
    actor_subject_id: String(raw.actor_subject_id ?? "").trim() || defaults.subjectId,
    workspace_id: String(raw.workspace_id ?? "").trim() || defaults.workspaceId,
  };
}

export function requireEdgeProjectId(args: Record<string, unknown>): string {
  const projectId = String(args.project_id ?? "").trim();
  if (!projectId) {
    throw new Error("project reference is required; pass project UUID or slug");
  }
  return projectId;
}

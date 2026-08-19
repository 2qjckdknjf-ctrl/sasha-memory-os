import { describe, expect, it } from "vitest";
import {
  applyEdgeDefaults,
  EDGE_INSTRUCTIONS,
  EDGE_TOOL_DEFS,
  requireEdgeProjectId,
} from "../../../supabase/functions/memory-mcp/contract.ts";

describe("supabase edge memory-mcp contract", () => {
  it("keeps the ChatGPT Edge tool surface at exactly 7 tools", () => {
    expect(EDGE_TOOL_DEFS.map((tool) => tool.name)).toEqual([
      "memory.search",
      "context.project",
      "memory.store_decision",
      "handoff.create",
      "capture.text",
      "memory.set_status",
      "memory.get",
    ]);
  });

  it("requires project_id only on write/context tools", () => {
    const requiredByTool = Object.fromEntries(
      EDGE_TOOL_DEFS.map((tool) => [tool.name, tool.inputSchema.required ?? []]),
    );

    expect(requiredByTool["memory.search"]).not.toContain("project_id");
    expect(requiredByTool["context.project"]).toContain("project_id");
    expect(requiredByTool["memory.store_decision"]).toContain("project_id");
    expect(requiredByTool["handoff.create"]).toContain("project_id");
    expect(requiredByTool["capture.text"]).toContain("project_id");
  });

  it("fills only actor/workspace defaults and never invents a project_id", () => {
    expect(
      applyEdgeDefaults(
        {},
        {
          subjectId: "subject-1",
          workspaceId: "workspace-1",
        },
      ),
    ).toEqual({
      actor_subject_id: "subject-1",
      workspace_id: "workspace-1",
    });
  });

  it("preserves an explicit project_id when provided", () => {
    expect(
      applyEdgeDefaults(
        { project_id: "44444444-4444-4444-8444-444444444401" },
        {
          subjectId: "subject-1",
          workspaceId: "workspace-1",
        },
      ),
    ).toEqual({
      project_id: "44444444-4444-4444-8444-444444444401",
      actor_subject_id: "subject-1",
      workspace_id: "workspace-1",
    });
  });

  it("throws when a write/context call omits project_id", () => {
    expect(() => requireEdgeProjectId({})).toThrow(
      /project reference is required; pass project UUID or slug/i,
    );
  });

  it("accepts an explicit project_id for write/context calls", () => {
    expect(
      requireEdgeProjectId({
        project_id: "44444444-4444-4444-8444-444444444401",
      }),
    ).toBe("44444444-4444-4444-8444-444444444401");
  });

  it("documents explicit project_id writes in instructions", () => {
    expect(EDGE_INSTRUCTIONS).toContain("writes require an explicit project_id");
  });
});

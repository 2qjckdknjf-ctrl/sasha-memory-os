import { describe, expect, it } from "vitest";
import {
  applyEdgeDefaults,
  EDGE_INSTRUCTIONS,
  EDGE_TOOL_DEFS,
  requireEdgeProjectId,
  resolveEdgeProjectId,
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

  it("resolves an explicit slug through the Edge project resolver", async () => {
    await expect(
      resolveEdgeProjectId({
        args: { project_id: "aistroyka" },
        mode: "required",
        resolve: async (projectRef) => {
          expect(projectRef).toBe("aistroyka");
          return {
            projectId: "44444444-4444-4444-8444-444444444401",
            matchCount: 1,
            candidates: [
              {
                id: "44444444-4444-4444-8444-444444444401",
                slug: "aistroyka",
                name: "AISTROYKA",
              },
            ],
          };
        },
      }),
    ).resolves.toBe("44444444-4444-4444-8444-444444444401");
  });

  it("throws not-found for an explicit unknown slug", async () => {
    await expect(
      resolveEdgeProjectId({
        args: { project_id: "missing-project" },
        mode: "required",
        resolve: async () => ({
          projectId: null,
          matchCount: 0,
          candidates: [],
        }),
      }),
    ).rejects.toThrow(/project not found; pass a valid project UUID or slug from \/projects/i);
  });

  it("keeps search workspace-wide when project_id is omitted", async () => {
    const resolve = async () => {
      throw new Error("resolver should not be called");
    };
    await expect(
      resolveEdgeProjectId({
        args: {},
        mode: "optional",
        resolve,
      }),
    ).resolves.toBeNull();
  });

  it("documents explicit project_id writes in instructions", () => {
    expect(EDGE_INSTRUCTIONS).toContain("writes require an explicit project_id");
  });
});

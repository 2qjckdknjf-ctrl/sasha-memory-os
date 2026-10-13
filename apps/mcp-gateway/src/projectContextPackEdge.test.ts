import { describe, expect, it } from "vitest";
import { buildProjectContextPack } from "@memory-os/schemas";
import {
  buildEdgeProjectContextPack,
  EDGE_PROJECT_CONTEXT_PACK_VERSION,
} from "../../../supabase/functions/memory-mcp/projectContextPack.ts";

const projectId = "44444444-4444-4444-8444-444444444402";

function memory(id: string, title: string, recordedAt: string) {
  return {
    id,
    effectiveProjectId: projectId,
    memory_type: "decision",
    title,
    content:
      "Merged: https://github.com/2qjckdknjf-ctrl/sasha-memory-os/pull/99\n" +
      "Merge SHA: 9d7e9216a5567455cf7dd6b9a8bec62dfb5739eb\n" +
      "Known external blockers remain:\n- OAuth consent absent\n" +
      "Next canonical slice: M18.2_PROJECT_CONTEXT_PACK",
    status: "verified",
    recorded_at: recordedAt,
    source_event_id: `event-${id}`,
  };
}

describe("Edge project context pack", () => {
  it("returns a bounded, cited, explicit-project pack", () => {
    const raw = {
        projectId,
        decisions: [
          memory("memory-1", "M18.1 CURSOR BOOTSTRAP LIVE PASS", "2026-10-13T15:45:00Z"),
          memory("memory-2", "Earlier milestone", "2026-10-12T15:45:00Z"),
        ],
        tasks: [],
        facts: [],
        latestHandoff: {
          id: "handoff-1",
          projectId,
          createdAt: "2026-10-13T15:59:00Z",
          payload: {
            completed: ["implementation complete"],
            validation: ["full gate passed"],
            open_items: ["review deployment receipt"],
            blockers: ["provider consent absent"],
            recommended_next: ["continue from handoff"],
          },
        },
      };
    const options = {
        projectId,
        maxTokens: 768,
        now: new Date("2026-10-13T16:00:00Z"),
      };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result).toMatchObject({
      packVersion: EDGE_PROJECT_CONTEXT_PACK_VERSION,
      projectId,
      provenance: {
        source: "context.project",
        subjectScoped: true,
        explicitProject: true,
      },
      sourceFreshness: { status: "fresh" },
      budget: { maxTokens: 768 },
    });
    expect(result.currentMilestone?.citations).toEqual(["memory:memory-1"]);
    expect(result.activeBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "OAuth consent absent" }),
      ]),
    );
    expect(result.latestHandoff?.validation[0]?.text).toBe("full gate passed");
    expect(result.nextWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "M18.2_PROJECT_CONTEXT_PACK" }),
      ]),
    );
    expect(result.budget.estimatedTokens).toBeLessThanOrEqual(768);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("fails closed when any source belongs to another project", () => {
    expect(() =>
      buildEdgeProjectContextPack(
        {
          projectId,
          decisions: [
            {
              ...memory("memory-1", "M18.1", "2026-10-13T15:45:00Z"),
              effectiveProjectId: "44444444-4444-4444-8444-444444444401",
            },
          ],
        },
        { projectId },
      )
    ).toThrow(/source project mismatch/i);
  });

  it("matches shared freshness and budget behavior for state-only context", () => {
    const raw = {
      projectId,
      decisions: [],
      tasks: [],
      facts: [],
      state: {
        id: "state-1",
        project_id: projectId,
        summary: "state ".repeat(2_000),
        created_at: "2026-10-13T15:59:30Z",
      },
    };
    const options = {
      projectId,
      maxTokens: 768,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.sourceFreshness).toMatchObject({
      status: "fresh",
      citations: ["project-state:state-1"],
    });
    expect(result.budget.estimatedTokens).toBeLessThanOrEqual(768);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });
});

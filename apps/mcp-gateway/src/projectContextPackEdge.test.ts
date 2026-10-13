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
    expect(result.activeBlockers[0]?.text).toContain("OAuth consent absent");
    expect(result.nextWork[0]?.text).toBe("M18.2_PROJECT_CONTEXT_PACK");
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
});

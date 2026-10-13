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

  it("matches shared prioritization of project-state active decision pins", () => {
    const pinnedId = "66666666-6666-4666-8666-666666666601";
    const newer = Array.from({ length: 7 }, (_, index) => ({
      ...memory(
        `newer-${index}`,
        `Newer decision ${index}`,
        `2026-10-13T15:5${index}:00Z`,
      ),
      content: `Newer decision content ${index}`,
    }));
    const raw = {
      projectId,
      decisions: [
        ...newer,
        {
          ...memory(
            pinnedId,
            "Pinned architecture decision",
            "2026-10-01T00:00:00Z",
          ),
          content: "This older decision remains canonical by project state.",
        },
      ],
      tasks: [],
      facts: [],
      state: {
        id: "state-pins",
        project_id: projectId,
        state: { active_decisions: [pinnedId] },
      },
    };
    const options = {
      projectId,
      maxTokens: 1800,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.canonicalDecisions[0]?.id).toBe(pinnedId);
    expect(result.canonicalDecisions).toHaveLength(6);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("matches shared precedence for newer project-state next work", () => {
    const raw = {
      projectId,
      decisions: [
        {
          ...memory("older-milestone", "M18.1 live pass", "2026-10-13T15:00:00Z"),
          content: "Next canonical slice: M18.2_OLD_NEXT",
        },
      ],
      tasks: [],
      facts: [],
      state: {
        id: "newer-state",
        project_id: projectId,
        created_at: "2026-10-13T15:59:00Z",
        state: { next: ["M18.2_REVISED_NEXT"] },
      },
    };
    const options = {
      projectId,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.currentGoal).toEqual({
      text: "M18.2_REVISED_NEXT",
      citations: ["project-state:newer-state"],
    });
    expect(result.nextWork[0]).toEqual(result.currentGoal);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("matches shared projection of in-progress project state", () => {
    const raw = {
      projectId,
      decisions: [],
      tasks: [],
      facts: [],
      state: {
        id: "active-state",
        project_id: projectId,
        summary: "General project summary",
        created_at: "2026-10-13T15:59:00Z",
        state: {
          in_progress: ["Finish the live context-pack acceptance"],
        },
      },
    };
    const options = { projectId };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.currentGoal).toEqual({
      text: "Finish the live context-pack acceptance",
      citations: ["project-state:active-state"],
    });
    expect(result.nextWork[0]).toEqual(result.currentGoal);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("matches shared active-task projection", () => {
    const raw = {
      projectId,
      decisions: [],
      tasks: [
        {
          id: "task-1",
          title: "Ship connector recovery",
          content: "Restore the provider callback and verify the receipt.",
          status: "active",
          project_id: projectId,
          recorded_at: "2026-10-13T15:59:00Z",
        },
      ],
      facts: [],
    };
    const options = {
      projectId,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.currentGoal?.text).toContain("Ship connector recovery");
    expect(result.currentGoal?.citations).toEqual(["memory:task-1"]);
    expect(result.nextWork[0]).toEqual(result.currentGoal);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("matches shared replacement of stale blockers by newer state", () => {
    const raw = {
      projectId,
      decisions: [
        {
          ...memory("older-blockers", "M18.1 live pass", "2026-10-13T15:00:00Z"),
          content: "Blockers:\n- stale blocker one\n- stale blocker two",
        },
      ],
      tasks: [],
      facts: [],
      state: {
        id: "newer-blocker-state",
        project_id: projectId,
        created_at: "2026-10-13T15:59:00Z",
        state: { blocked: ["current blocker"] },
      },
    };
    const options = {
      projectId,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);
    expect(result.activeBlockers).toEqual([
      {
        text: "current blocker",
        citations: ["project-state:newer-blocker-state"],
      },
    ]);
    expect(result).toEqual(buildProjectContextPack(raw, options));

    const clearedRaw = {
      ...raw,
      state: { ...raw.state, state: { blocked: [] } },
    };
    const cleared = buildEdgeProjectContextPack(clearedRaw, options);
    expect(cleared.activeBlockers).toEqual([]);
    expect(cleared).toEqual(buildProjectContextPack(clearedRaw, options));
  });

  it("matches shared canonical retention at the minimum token budget", () => {
    const decisions = Array.from({ length: 3 }, (_, index) => ({
      ...memory(
        `merge-decision-${index}`,
        `M18 decision ${index}`,
        `2026-10-13T15:0${index}:00Z`,
      ),
      content:
        `PR: https://github.com/example/repo/pull/${index + 1}\n` +
        `Merge SHA: ${String(index + 1).repeat(40)}\n` +
        "Architecture evidence ".repeat(40),
    }));
    const raw = { projectId, decisions, tasks: [], facts: [] };
    const options = {
      projectId,
      maxTokens: 768,
      now: new Date("2026-10-13T16:00:00Z"),
    };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.budget.truncated).toBe(true);
    expect(result.canonicalDecisions.length).toBeGreaterThanOrEqual(1);
    expect(result.recentMerges.length).toBeLessThan(3);
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });

  it("matches shared merge-evidence classification", () => {
    const raw = {
      projectId,
      decisions: [
        {
          ...memory("open-pr", "Review PR #101", "2026-10-13T15:59:00Z"),
          content: "PR: https://github.com/example/repo/pull/101",
        },
        {
          ...memory("merged-pr", "Completed PR #100", "2026-10-13T15:58:00Z"),
          content: "Merged: https://github.com/example/repo/pull/100",
        },
      ],
      tasks: [],
      facts: [],
    };
    const options = { projectId };
    const result = buildEdgeProjectContextPack(raw, options);

    expect(result.recentMerges).toHaveLength(1);
    expect(result.recentMerges[0]).toMatchObject({
      pullRequestUrl: "https://github.com/example/repo/pull/100",
      mergeSha: null,
    });
    expect(result).toEqual(buildProjectContextPack(raw, options));
  });
});

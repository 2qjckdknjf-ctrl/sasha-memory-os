import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OWNER =
  Deno.env.get("MEMORY_OS_OWNER_SUBJECT_ID") ??
  "33333333-3333-4333-8333-333333333301";
const WORKSPACE =
  Deno.env.get("MEMORY_OS_WORKSPACE_ID") ??
  "11111111-1111-4111-8111-111111111111";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      connection: "keep-alive",
    },
  });
}

function extractSecret(req: Request): string | null {
  const header = req.headers.get("x-memory-os-api-secret")?.trim();
  if (header) return header;
  const auth = req.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    // Ignore Supabase anon/service JWTs here — ops secret is separate header.
    if (token && !token.includes(".")) return token;
  }
  return null;
}

function pathOf(req: Request): string {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/worker-ticks/, "") || "/";
}

Deno.serve(async (req: Request) => {
  const path = pathOf(req);
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return json({ ok: true, service: "memory-os-worker-ticks" });
  }

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const secret = extractSecret(req);
  if (!secret) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "missing supabase env" }, 500);
  }
  const client = createClient(supabaseUrl, supabaseKey);

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string;
    actor_subject_id?: string;
    older_than_minutes?: number;
    enqueue?: boolean;
    apply?: boolean;
    limit?: number;
  };
  const subjectId = body.actor_subject_id ?? OWNER;
  const workspaceId = body.workspace_id ?? WORKSPACE;

  try {
    if (path === "/v1/consolidation/run") {
      const enq = await client.rpc("api_enqueue_consolidation", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_workspace_id: workspaceId,
      });
      if (enq.error) throw enq.error;
      const done = await client.rpc("api_complete_consolidation", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_job_id: (enq.data as { jobId?: string })?.jobId,
        p_status: "succeeded",
        p_error: null,
      });
      if (done.error) throw done.error;
      return json({
        ok: true,
        enqueue: enq.data,
        complete: done.data,
        note: "edge tick: enqueue+complete (full consolidate via Node worker when hosted)",
      });
    }

    if (path === "/v1/connections/sync") {
      const enq = await client.rpc("api_enqueue_connector_sync", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_workspace_id: workspaceId,
      });
      if (enq.error) throw enq.error;
      return json({ ok: true, enqueue: enq.data });
    }

    if (path === "/v1/jobs/dead-letter-stale") {
      const stale = await client.rpc("api_dead_letter_stale_jobs", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_workspace_id: workspaceId,
        p_older_than_minutes: body.older_than_minutes ?? 60,
      });
      if (stale.error) throw stale.error;
      return json({ ok: true, ...((stale.data as object) ?? {}) });
    }

    if (path === "/v1/memories/embed-missing") {
      return json({
        ok: true,
        skipped: true,
        note: "embed-missing requires Node embed adapters; run API/worker for this step",
      });
    }

    return json({ error: "not found", path }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

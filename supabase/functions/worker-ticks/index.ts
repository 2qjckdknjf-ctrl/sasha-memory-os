import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const OWNER =
  Deno.env.get("MEMORY_OS_OWNER_SUBJECT_ID") ??
  "33333333-3333-4333-8333-333333333301";
const WORKSPACE =
  Deno.env.get("MEMORY_OS_WORKSPACE_ID") ??
  "11111111-1111-4111-8111-111111111111";

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  status: string;
  recordedAt?: string;
  embedding?: number[] | null;
};

type Pair = {
  keeperId: string;
  duplicateId: string;
  score: number;
  reason: string;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", connection: "keep-alive" },
  });
}

function extractSecret(req: Request): string | null {
  const header = req.headers.get("x-memory-os-api-secret")?.trim();
  if (header) return header;
  const auth = req.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && !token.includes(".")) return token;
  }
  return null;
}

function pathOf(req: Request): string {
  const url = new URL(req.url);
  return url.pathname.replace(/^\/worker-ticks/, "") || "/";
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function hashEmbed(text: string, dimensions = 32): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    vec[i % dimensions] += ((code % 31) - 15) / 15;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

function planPairs(candidates: MemoryRow[], threshold = 0.92): Pair[] {
  const pool = candidates.filter((c) => c.status === "candidate");
  if (pool.length < 2) return [];
  const pairs: Pair[] = [];
  const used = new Set<string>();
  const byTitle = new Map<string, MemoryRow[]>();
  for (const item of pool) {
    const key = normalizeTitle(item.title);
    if (!key) continue;
    const list = byTitle.get(key) ?? [];
    list.push(item);
    byTitle.set(key, list);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) =>
      (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "")
    );
    const keeper = sorted[0]!;
    for (const dup of sorted.slice(1)) {
      if (used.has(dup.id) || used.has(keeper.id)) continue;
      pairs.push({
        keeperId: keeper.id,
        duplicateId: dup.id,
        score: 1,
        reason: "exact-title",
      });
      used.add(dup.id);
    }
  }
  const remaining = pool.filter((c) => !used.has(c.id));
  const vectors = remaining.map((item) =>
    Array.isArray(item.embedding) && item.embedding.length > 0
      ? item.embedding
      : hashEmbed(`${item.title}\n${item.content}`)
  );
  for (let i = 0; i < remaining.length; i += 1) {
    const left = remaining[i]!;
    if (used.has(left.id)) continue;
    for (let j = i + 1; j < remaining.length; j += 1) {
      const right = remaining[j]!;
      if (used.has(right.id)) continue;
      const score = cosine(vectors[i] ?? [], vectors[j] ?? []);
      if (score < threshold) continue;
      const keeper =
        (left.recordedAt ?? "") >= (right.recordedAt ?? "") ? left : right;
      const duplicate = keeper.id === left.id ? right : left;
      pairs.push({
        keeperId: keeper.id,
        duplicateId: duplicate.id,
        score,
        reason: "embed-similarity",
      });
      used.add(duplicate.id);
    }
  }
  return pairs;
}

async function embedText(
  title: string,
  text: string,
): Promise<{ vector: number[]; engine: string }> {
  const apiKey = Deno.env.get("MEMORY_OS_OPENAI_API_KEY")?.trim() ??
    Deno.env.get("OPENAI_API_KEY")?.trim();
  const dims = Number(Deno.env.get("MEMORY_OS_OPENAI_EMBED_DIMS") ?? "32") || 32;
  if (!apiKey) {
    return {
      vector: hashEmbed(`${title}\n${text}`, dims === 1536 ? 32 : dims),
      engine: "stub-hash",
    };
  }
  const model = Deno.env.get("MEMORY_OS_OPENAI_EMBED_MODEL") ??
    "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [`${title}\n${text}`],
      dimensions: dims === 1536 || dims === 32 ? dims : 32,
    }),
  });
  if (!res.ok) {
    return {
      vector: hashEmbed(`${title}\n${text}`, 32),
      engine: "stub-hash-fallback",
    };
  }
  const payload = await res.json() as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vector = payload.data?.[0]?.embedding ?? [];
  return {
    vector: vector.length ? vector : hashEmbed(`${title}\n${text}`, 32),
    engine: vector.length ? "openai" : "stub-hash",
  };
}

async function runConsolidation(
  client: SupabaseClient,
  secret: string,
  subjectId: string,
  workspaceId: string,
) {
  const enq = await client.rpc("api_enqueue_consolidation", {
    p_secret: secret,
    p_subject_id: subjectId,
    p_workspace_id: workspaceId,
  });
  if (enq.error) throw enq.error;

  const listed = await client.rpc("api_list_memories", {
    p_secret: secret,
    p_subject_id: subjectId,
    p_workspace_id: workspaceId,
    p_project_id: null,
    p_status: "candidate",
    p_limit: 100,
  });
  if (listed.error) throw listed.error;
  const rows = (listed.data ?? []) as MemoryRow[];
  const planned = planPairs(rows);
  const applied: Pair[] = [];
  const failed: Array<{ pair: Pair; error: string }> = [];
  for (const pair of planned) {
    const result = await client.rpc("api_supersede_memory", {
      p_secret: secret,
      p_subject_id: subjectId,
      p_duplicate_id: pair.duplicateId,
      p_keeper_id: pair.keeperId,
      p_reason: `edge-consolidation: ${pair.reason}`,
    });
    if (result.error) {
      failed.push({ pair, error: result.error.message });
    } else {
      applied.push(pair);
    }
  }

  const status = failed.length > 0 && applied.length === 0 ? "failed" : "succeeded";
  const done = await client.rpc("api_complete_consolidation", {
    p_secret: secret,
    p_subject_id: subjectId,
    p_job_id: (enq.data as { jobId?: string })?.jobId,
    p_status: status,
    p_error: failed.map((f) => f.error).join("; ").slice(0, 500) || null,
  });
  if (done.error) throw done.error;

  return {
    ok: true,
    scanned: rows.length,
    planned: planned.length,
    applied: applied.length,
    failed,
    enqueue: enq.data,
    complete: done.data,
  };
}

async function runEmbedMissing(
  client: SupabaseClient,
  secret: string,
  subjectId: string,
  workspaceId: string,
  limit: number,
) {
  const listed = await client.rpc("api_list_memories", {
    p_secret: secret,
    p_subject_id: subjectId,
    p_workspace_id: workspaceId,
    p_project_id: null,
    p_status: null,
    p_limit: 200,
  });
  if (listed.error) throw listed.error;
  const rows = (listed.data ?? []) as MemoryRow[];
  const missing = rows.filter(
    (row) => !Array.isArray(row.embedding) || row.embedding.length === 0,
  );
  const batch = missing.slice(0, limit);
  const results: Array<{ memoryId: string; dims: number; engine: string }> = [];
  const failed: Array<{ memoryId: string; error: string }> = [];

  for (const row of batch) {
    try {
      // Prefer full body when available via get_memory
      const full = await client.rpc("api_get_memory", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_memory_id: row.id,
      });
      if (full.error) throw full.error;
      const mem = full.data as MemoryRow;
      const embedded = await embedText(mem.title, mem.content);
      if (!embedded.vector.length) {
        failed.push({ memoryId: row.id, error: "empty embedding vector" });
        continue;
      }
      const saved = await client.rpc("api_set_memory_embedding", {
        p_secret: secret,
        p_subject_id: subjectId,
        p_memory_id: row.id,
        p_embedding: embedded.vector,
        p_engine: embedded.engine,
      });
      if (saved.error) throw saved.error;
      results.push({
        memoryId: row.id,
        dims: (saved.data as { dims?: number })?.dims ?? embedded.vector.length,
        engine: embedded.engine,
      });
    } catch (err) {
      failed.push({
        memoryId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    scanned: rows.length,
    missing: missing.length,
    embedded: results.length,
    failed,
    results,
  };
}

Deno.serve(async (req: Request) => {
  const path = pathOf(req);
  if (req.method === "GET" && (path === "/" || path === "/health")) {
    return json({ ok: true, service: "memory-os-worker-ticks", version: 2 });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secret = extractSecret(req);
  if (!secret) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "missing supabase env" }, 500);
  }
  const client = createClient(supabaseUrl, supabaseKey);

  const body = (await req.json().catch(() => ({}))) as {
    workspace_id?: string;
    actor_subject_id?: string;
    older_than_minutes?: number;
    limit?: number;
  };
  const subjectId = body.actor_subject_id ?? OWNER;
  const workspaceId = body.workspace_id ?? WORKSPACE;

  try {
    if (path === "/v1/consolidation/run") {
      return json(
        await runConsolidation(client, secret, subjectId, workspaceId),
      );
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
      const limit = Math.min(Math.max(Number(body.limit ?? 25) || 25, 1), 100);
      return json(
        await runEmbedMissing(client, secret, subjectId, workspaceId, limit),
      );
    }
    return json({ error: "not found", path }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
});

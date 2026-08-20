import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const OWNER =
  Deno.env.get("MEMORY_OS_OWNER_SUBJECT_ID") ??
  "33333333-3333-4333-8333-333333333301";
const WORKSPACE =
  Deno.env.get("MEMORY_OS_WORKSPACE_ID") ??
  "11111111-1111-4111-8111-111111111111";
const PROACTIVE_CONSOLIDATION_PROJECT_ERROR =
  "project_id is required for proactive consolidation; never default to AISTROYKA";
const PROACTIVE_CONSOLIDATION_RULES_VERSION = "m13-s04-v1";
const CONFLICTING_MEMORY_STATUSES = new Set([
  "disputed",
  "superseded",
  "retracted",
  "deleted",
]);

type MemoryRow = {
  id: string;
  title: string;
  content: string;
  status: string;
  recordedAt?: string;
  embedding?: number[] | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
};

type Pair = {
  keeperId: string;
  duplicateId: string;
  score: number;
  reason: string;
};

type CandidateConflict = {
  title: string;
  reason: "same-title-divergent-content" | "same-title-reviewed-history";
  memoryIds: string[];
  statuses: string[];
  recordedAts: string[];
};

type DetectedConflict = {
  key: string;
  title: string;
  projectId: string | null;
  reason:
    | "same-title-divergent-content"
    | "disputed-current-fact"
    | "superseded-current-fact"
    | "retracted-current-fact"
    | "corrected-current-fact";
  memoryIds: [string, string];
  evidence: [
    { memoryId: string; title: string },
    { memoryId: string; title: string },
  ];
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

function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function projectScopeKey(projectId?: string | null): string {
  return projectId?.trim() || "__workspace__";
}

function normalizeProjectScopedTitle(projectId: string | null | undefined, title: string): string {
  const normalizedTitle = normalizeTitle(title);
  return normalizedTitle ? `${projectScopeKey(projectId)}::${normalizedTitle}` : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function correctedFromOf(row: MemoryRow): string | null {
  const metadata = asRecord(row.metadata);
  const correctedFrom = metadata?.corrected_from;
  return typeof correctedFrom === "string" && correctedFrom.trim()
    ? correctedFrom
    : null;
}

function correctedByOf(row: MemoryRow): string | null {
  const metadata = asRecord(row.metadata);
  const correctedBy = metadata?.corrected_by;
  return typeof correctedBy === "string" && correctedBy.trim()
    ? correctedBy
    : null;
}

function isHistoricalConflictStatus(status: string): boolean {
  return CONFLICTING_MEMORY_STATUSES.has(status) && !isCurrentishStatus(status);
}

function inferPairConflictReason(left: MemoryRow, right: MemoryRow): DetectedConflict["reason"] | null {
  const leftCurrentish = isCurrentishStatus(left.status);
  const rightCurrentish = isCurrentishStatus(right.status);
  const leftHistorical = isHistoricalConflictStatus(left.status);
  const rightHistorical = isHistoricalConflictStatus(right.status);
  const correctedRelation =
    correctedFromOf(left) === right.id ||
    correctedFromOf(right) === left.id ||
    correctedByOf(left) === right.id ||
    correctedByOf(right) === left.id;
  if (correctedRelation && ((leftCurrentish && rightHistorical) || (rightCurrentish && leftHistorical))) {
    return "corrected-current-fact";
  }
  if (
    (left.status === "disputed" && rightCurrentish && right.status !== "disputed") ||
    (right.status === "disputed" && leftCurrentish && left.status !== "disputed")
  ) {
    return "disputed-current-fact";
  }
  if (
    (left.status === "superseded" && rightCurrentish) ||
    (right.status === "superseded" && leftCurrentish)
  ) {
    return "superseded-current-fact";
  }
  if (
    (left.status === "retracted" && rightCurrentish) ||
    (right.status === "retracted" && leftCurrentish)
  ) {
    return "retracted-current-fact";
  }
  if (leftCurrentish && rightCurrentish) {
    return normalizeContent(left.content) !== normalizeContent(right.content)
      ? "same-title-divergent-content"
      : null;
  }
  return null;
}

function pairConflictKey(
  leftId: string,
  rightId: string,
  reason: DetectedConflict["reason"],
): string {
  return [leftId, rightId].sort((a, b) => a.localeCompare(b)).join("::") + `::${reason}`;
}

function sortForProactive(left: MemoryRow, right: MemoryRow): number {
  const byRecordedAt = (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "");
  if (byRecordedAt !== 0) return byRecordedAt;
  const byTitle = normalizeTitle(left.title).localeCompare(normalizeTitle(right.title));
  if (byTitle !== 0) return byTitle;
  return left.id.localeCompare(right.id);
}

function isCurrentishStatus(status: string): boolean {
  return (
    status === "candidate" ||
    status === "active" ||
    status === "verified" ||
    status === "disputed"
  );
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
    const key = normalizeProjectScopedTitle(item.projectId, item.title);
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
      if (projectScopeKey(left.projectId) !== projectScopeKey(right.projectId)) continue;
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

function buildCandidateConflicts(
  candidates: MemoryRow[],
  pairs: Pair[],
): CandidateConflict[] {
  const grouped = new Map<string, MemoryRow[]>();
  for (const candidate of candidates) {
    if (!isCurrentishStatus(candidate.status)) continue;
    const key = normalizeProjectScopedTitle(candidate.projectId, candidate.title);
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }
  const mergedIds = new Set<string>();
  for (const pair of pairs) {
    mergedIds.add(pair.keeperId);
    mergedIds.add(pair.duplicateId);
  }
  return [...grouped.values()]
    .filter((group) => group.length >= 2)
    .map((group) => [...group].sort(sortForProactive))
    .flatMap((group) => {
      const distinctBodies = new Set(group.map((item) => normalizeContent(item.content)));
      const hasReviewedMemory = group.some((item) => item.status !== "candidate");
      const fullyCoveredByMerge = group.every((item) => mergedIds.has(item.id));
      if (distinctBodies.size <= 1 && !hasReviewedMemory) return [];
      if (fullyCoveredByMerge && !hasReviewedMemory) return [];
      return [{
        title: group[0]?.title ?? "untitled",
        reason: distinctBodies.size > 1
          ? "same-title-divergent-content"
          : "same-title-reviewed-history",
        memoryIds: group.map((item) => item.id),
        statuses: group.map((item) => item.status),
        recordedAts: group.map((item) => item.recordedAt ?? ""),
      }];
    });
}

function buildDetectedConflicts(
  candidates: MemoryRow[],
  pairs: Pair[],
): DetectedConflict[] {
  const grouped = new Map<string, MemoryRow[]>();
  for (const candidate of candidates) {
    const key = normalizeProjectScopedTitle(candidate.projectId, candidate.title);
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(candidate);
    grouped.set(key, list);
  }
  const mergedIds = new Set<string>();
  for (const pair of pairs) {
    mergedIds.add(pair.keeperId);
    mergedIds.add(pair.duplicateId);
  }
  const detected = new Map<string, DetectedConflict>();
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(sortForProactive);
    for (let i = 0; i < sorted.length; i += 1) {
      const left = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const right = sorted[j]!;
        const reason = inferPairConflictReason(left, right);
        if (!reason) continue;
        const bothCandidate = left.status === "candidate" && right.status === "candidate";
        const sameBody = normalizeContent(left.content) === normalizeContent(right.content);
        if (bothCandidate && sameBody && mergedIds.has(left.id) && mergedIds.has(right.id)) {
          continue;
        }
        const key = pairConflictKey(left.id, right.id, reason);
        if (detected.has(key)) continue;
        const pair = [left, right].sort((a, b) => a.id.localeCompare(b.id)) as [
          MemoryRow,
          MemoryRow,
        ];
        detected.set(key, {
          key,
          title: pair[0].title || pair[1].title || "untitled",
          projectId: pair[0].projectId ?? pair[1].projectId ?? null,
          reason,
          memoryIds: [pair[0].id, pair[1].id],
          evidence: [
            { memoryId: pair[0].id, title: pair[0].title || "untitled" },
            { memoryId: pair[1].id, title: pair[1].title || "untitled" },
          ],
        });
      }
    }
  }
  return [...detected.values()].sort((left, right) => {
    const byProject = projectScopeKey(left.projectId).localeCompare(projectScopeKey(right.projectId));
    if (byProject !== 0) return byProject;
    const byTitle = normalizeTitle(left.title).localeCompare(normalizeTitle(right.title));
    if (byTitle !== 0) return byTitle;
    return left.key.localeCompare(right.key);
  });
}

function buildProactiveReason(runId: string, pairReason: string): string {
  return `consolidation.proactive ${PROACTIVE_CONSOLIDATION_RULES_VERSION} run ${runId}: ${pairReason}`;
}

function planProactiveConsolidation(
  candidates: MemoryRow[],
  options?: {
    scanLimit?: number;
    maxMerges?: number;
    maxConflicts?: number;
  },
) {
  const scanLimit = Math.min(Math.max(Number(options?.scanLimit ?? 100) || 100, 1), 500);
  const maxMerges = Math.min(Math.max(Number(options?.maxMerges ?? 12) || 12, 0), 100);
  const maxConflicts = Math.min(Math.max(Number(options?.maxConflicts ?? 12) || 12, 0), 100);
  const scannedPool = [...candidates].sort(sortForProactive).slice(0, scanLimit);
  const mergeCandidatesAll = planPairs(scannedPool);
  const candidateConflictsAll = buildCandidateConflicts(scannedPool, mergeCandidatesAll);
  const detectedConflictsAll = buildDetectedConflicts(scannedPool, mergeCandidatesAll);
  const mergeCandidates = mergeCandidatesAll.slice(0, maxMerges);
  const candidateConflicts = candidateConflictsAll.slice(0, maxConflicts);
  const detectedConflicts = detectedConflictsAll.slice(0, maxConflicts);
  const stopReason =
    candidates.length > scanLimit
      ? "max_records"
      : mergeCandidatesAll.length > mergeCandidates.length
      ? "max_merges"
      : candidateConflictsAll.length > candidateConflicts.length ||
          detectedConflictsAll.length > detectedConflicts.length
      ? "max_conflicts"
      : "completed";
  return {
    scanned: scannedPool.length,
    inputMemoryIds: scannedPool.map((item) => item.id),
    mergeCandidates,
    mergeCandidatesTotal: mergeCandidatesAll.length,
    candidateConflicts,
    candidateConflictsTotal: candidateConflictsAll.length,
    detectedConflicts,
    detectedConflictsTotal: detectedConflictsAll.length,
    stopReason,
    exhausted: stopReason !== "completed",
    verifiedWrites: 0 as const,
  };
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
    project_id?: string;
    older_than_minutes?: number;
    limit?: number;
    scan_limit?: number;
    max_merges?: number;
    max_conflicts?: number;
    proactive?: boolean;
    reason?: string;
  };
  const subjectId = body.actor_subject_id ?? OWNER;
  const workspaceId = body.workspace_id ?? WORKSPACE;

  try {
    if (path === "/v1/consolidation/run") {
      if (body.proactive === true) {
        const projectId = body.project_id?.trim();
        if (!projectId) {
          return json({ error: PROACTIVE_CONSOLIDATION_PROJECT_ERROR }, 400);
        }
        const runId = crypto.randomUUID();
        const scanLimit = body.scan_limit ?? body.limit ?? 100;
        const enq = await client.rpc("api_enqueue_project_consolidation", {
          p_secret: secret,
          p_subject_id: subjectId,
          p_workspace_id: workspaceId,
          p_project_id: projectId,
          p_reason: body.reason ?? null,
        });
        if (enq.error) throw enq.error;
        const listed = await client.rpc("api_list_memories", {
          p_secret: secret,
          p_subject_id: subjectId,
          p_workspace_id: workspaceId,
          p_project_id: projectId,
          p_status: null,
          p_limit: scanLimit,
        });
        if (listed.error) throw listed.error;
        const rows = (listed.data ?? []) as MemoryRow[];
        const plan = planProactiveConsolidation(rows, {
          scanLimit,
          maxMerges: body.max_merges,
          maxConflicts: body.max_conflicts,
        });
        const persistedConflictIds: string[] = [];
        for (const conflict of plan.detectedConflicts) {
          const persisted = await client.rpc("api_upsert_memory_conflict", {
            p_secret: secret,
            p_subject_id: subjectId,
            p_workspace_id: workspaceId,
            p_project_id: projectId,
            p_conflict_key: conflict.key,
            p_title: conflict.title,
            p_reason: conflict.reason,
            p_left_memory_id: conflict.memoryIds[0],
            p_right_memory_id: conflict.memoryIds[1],
            p_evidence_refs: conflict.evidence,
            p_detector_version: PROACTIVE_CONSOLIDATION_RULES_VERSION,
          });
          if (persisted.error) throw persisted.error;
          const conflictId = (persisted.data as { id?: string })?.id ?? null;
          if (conflictId) {
            persistedConflictIds.push(conflictId);
            const conflictAudit = await client.rpc("api_append_audit_event", {
              p_secret: secret,
              p_subject_id: subjectId,
              p_workspace_id: workspaceId,
              p_action: "memory_conflict.detected",
              p_object_type: "memory_conflict",
              p_object_id: conflictId,
              p_reason: conflict.reason,
              p_before_state: null,
              p_after_state: {
                runId,
                projectId,
                rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
                conflictKey: conflict.key,
                title: conflict.title,
                reason: conflict.reason,
                memoryIds: conflict.memoryIds,
                evidence: conflict.evidence,
              },
            });
            if (conflictAudit.error) throw conflictAudit.error;
          }
        }
        const applied: Pair[] = [];
        const failed: Array<{ pair: Pair; error: string }> = [];
        for (const pair of plan.mergeCandidates) {
          const result = await client.rpc("api_supersede_memory", {
            p_secret: secret,
            p_subject_id: subjectId,
            p_duplicate_id: pair.duplicateId,
            p_keeper_id: pair.keeperId,
            p_reason: buildProactiveReason(runId, pair.reason),
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
        const audit = await client.rpc("api_append_audit_event", {
          p_secret: secret,
          p_subject_id: subjectId,
          p_workspace_id: workspaceId,
          p_action: "consolidation.proactive.completed",
          p_object_type: "consolidation_run",
          p_object_id: runId,
          p_reason: "project-scoped proactive consolidation",
          p_before_state: null,
          p_after_state: {
            runId,
            projectId,
            rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
            jobId: (enq.data as { jobId?: string })?.jobId ?? null,
            eventId: (enq.data as { eventId?: string })?.eventId ?? null,
            scanned: plan.scanned,
            inputMemoryIds: plan.inputMemoryIds,
            mergeCandidates: plan.mergeCandidates,
            mergeCandidatesTotal: plan.mergeCandidatesTotal,
            candidateConflicts: plan.candidateConflicts,
            candidateConflictsTotal: plan.candidateConflictsTotal,
            detectedConflicts: plan.detectedConflicts,
            detectedConflictsTotal: plan.detectedConflictsTotal,
            persistedConflictIds,
            appliedPairs: applied,
            failedPairs: failed,
            stopReason: plan.stopReason,
            exhausted: plan.exhausted,
            verifiedWrites: 0,
          },
        });
        if (audit.error) throw audit.error;
        return json({
          ok: true,
          runId,
          projectId,
          rulesVersion: PROACTIVE_CONSOLIDATION_RULES_VERSION,
          scanned: plan.scanned,
          planned: plan.mergeCandidates.length,
          pairs: plan.mergeCandidates,
          mergeCandidatesTotal: plan.mergeCandidatesTotal,
          candidateConflicts: plan.candidateConflicts,
          candidateConflictsTotal: plan.candidateConflictsTotal,
          detectedConflicts: plan.detectedConflicts,
          detectedConflictsTotal: plan.detectedConflictsTotal,
          persistedConflictIds,
          applied,
          failed,
          stopReason: plan.stopReason,
          exhausted: plan.exhausted,
          verifiedWrites: 0,
          auditEventId: (audit.data as { id?: string })?.id ?? null,
          enqueue: enq.data,
          complete: done.data,
        });
      }
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

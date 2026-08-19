import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  applyEdgeDefaults,
  EDGE_INSTRUCTIONS,
  EDGE_TOOL_DEFS,
  resolveEdgeProjectId,
} from "./contract.ts";

const SUBJECT = Deno.env.get("MEMORY_OS_CHATGPT_SUBJECT_ID") ??
  "33333333-3333-4333-8333-333333333302";
const WORKSPACE = Deno.env.get("MEMORY_OS_DEFAULT_WORKSPACE_ID") ??
  "11111111-1111-4111-8111-111111111111";
const PROJECT = Deno.env.get("MEMORY_OS_DEFAULT_PROJECT_ID") ??
  "44444444-4444-4444-8444-444444444401";
const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ??
  "https://vpxblcxsvlylqyldiuwr.supabase.co").replace(/\/$/, "");
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1/memory-mcp`;
const MCP_RESOURCE = `${FUNCTION_BASE}/mcp`;
const RESOURCE_METADATA_URL =
  `${FUNCTION_BASE}/.well-known/oauth-protected-resource`;
const OAUTH_ISSUER = `${SUPABASE_URL}/auth/v1`;
const OAUTH_SCOPES = ["openid", "email", "profile"];
const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: OAUTH_SCOPES }];

const READ_ONLY = new Set(["memory.search", "memory.get", "context.project"]);
const tools = EDGE_TOOL_DEFS.map((tool) => ({
  ...tool,
  securitySchemes: OAUTH_SECURITY_SCHEMES,
  _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
  annotations: {
    readOnlyHint: READ_ONLY.has(tool.name),
    destructiveHint: !READ_ONLY.has(tool.name),
    openWorldHint: false,
  },
}));

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...extra,
    },
  });
}

function pathOf(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const marker = "/memory-mcp";
  const at = pathname.indexOf(marker);
  if (at >= 0) return pathname.slice(at + marker.length) || "/";
  return pathname || "/";
}

function extractSecret(req: Request): string | null {
  const direct = req.headers.get("x-memory-os-api-secret")?.trim();
  if (direct) return direct;
  const auth = req.headers.get("authorization")?.trim();
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function oauthChallenge(
  error = "invalid_token",
  description = "Sign in to Sasha Memory OS to continue",
): string {
  return `Bearer resource_metadata="${RESOURCE_METADATA_URL}", scope="${
    OAUTH_SCOPES.join(" ")
  }", error="${error}", error_description="${description}"`;
}

function unauthorized(description = "Authentication required"): Response {
  return json({ error: "unauthorized", error_description: description }, 401, {
    "www-authenticate": oauthChallenge("invalid_token", description),
  });
}

function authRequiredResult(
  id: RpcReq["id"],
  description = "Authentication required",
) {
  return ok(id, {
    content: [{ type: "text", text: description }],
    isError: true,
    _meta: {
      "mcp/www_authenticate": [
        oauthChallenge("insufficient_scope", description),
      ],
    },
  });
}

async function validateLegacySecret(
  client: SupabaseClient,
  secret: string,
): Promise<boolean> {
  const exact = await client.rpc("api_validate_secret", { p_secret: secret });
  if (!exact.error) return exact.data === true;

  // Safe rollout fallback: the validator RPC is added immediately after the
  // Edge Function. Until then the original probe still validates the secret.
  return authorize(client, secret);
}

function claimString(claims: Record<string, unknown>, key: string): string {
  return String(claims[key] ?? "").trim();
}

async function validateOAuthToken(token: string): Promise<boolean> {
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const allowedEmail = Deno.env.get("MEMORY_OS_OAUTH_ALLOWED_EMAIL")?.trim()
    .toLowerCase();
  if (!publishableKey || !allowedEmail) return false;

  const authClient = createClient(SUPABASE_URL, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getClaims(token);
  const claims = data?.claims as Record<string, unknown> | undefined;
  if (error || !claims) return false;

  const issuer = claimString(claims, "iss");
  const email = claimString(claims, "email").toLowerCase();
  const clientId = claimString(claims, "client_id");
  const expiresAt = Number(claims.exp ?? 0);
  const audience = Array.isArray(claims.aud)
    ? claims.aud.map(String)
    : [claimString(claims, "aud")];
  if (
    issuer !== OAUTH_ISSUER || email !== allowedEmail || !clientId ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    (!audience.includes("authenticated") && !audience.includes(MCP_RESOURCE))
  ) return false;

  // Confirm the session/user is still valid rather than trusting claims alone.
  const { data: userData, error: userError } = await authClient.auth.getUser(
    token,
  );
  return !userError &&
    userData.user?.email?.trim().toLowerCase() === allowedEmail;
}

async function authenticate(
  req: Request,
  serviceClient: SupabaseClient,
): Promise<{ rpcSecret: string; mode: "oauth2" | "api_secret" } | null> {
  const credential = extractSecret(req);
  if (!credential) return null;
  if (await validateLegacySecret(serviceClient, credential)) {
    return { rpcSecret: credential, mode: "api_secret" };
  }
  if (await validateOAuthToken(credential)) {
    return { rpcSecret: "oauth2-service-role", mode: "oauth2" };
  }
  return null;
}

function resourceMetadata(): Record<string, unknown> {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: `${FUNCTION_BASE}/health`,
  };
}

function defaults(raw: Record<string, unknown>): Record<string, unknown> {
  return applyEdgeDefaults(raw, {
    subjectId: SUBJECT,
    workspaceId: WORKSPACE,
  });
}

async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

async function authorize(
  client: SupabaseClient,
  secret: string,
): Promise<boolean> {
  const { error } = await client.rpc("api_rls_probe", {
    p_secret: secret,
    p_subject_id: SUBJECT,
    p_project_id: PROJECT,
    p_sensitivity: "internal",
  });
  return !error;
}

function snakeOrCamel(
  row: Record<string, unknown>,
  snake: string,
  camel: string,
): unknown {
  return row[camel] ?? row[snake] ?? null;
}

function normalizeMemory(value: unknown): Record<string, unknown> {
  const row = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    ...row,
    id: row.id ?? null,
    workspaceId: snakeOrCamel(row, "workspace_id", "workspaceId"),
    projectId: snakeOrCamel(row, "project_id", "projectId"),
    memoryType: snakeOrCamel(row, "memory_type", "memoryType"),
    recordedAt: snakeOrCamel(row, "recorded_at", "recordedAt"),
    validFrom: snakeOrCamel(row, "valid_from", "validFrom"),
    validTo: snakeOrCamel(row, "valid_to", "validTo"),
    observedAt: snakeOrCamel(row, "observed_at", "observedAt"),
    supersededBy: snakeOrCamel(row, "superseded_by", "supersededBy"),
    sourceEventId: snakeOrCamel(row, "source_event_id", "sourceEventId"),
    createdBySubject: snakeOrCamel(
      row,
      "created_by_subject",
      "createdBySubject",
    ),
    schemaVersion: snakeOrCamel(row, "schema_version", "schemaVersion"),
  };
}

function asVector(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((v) => typeof v === "number")) {
    return value as number[];
  }
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "number")) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
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
  return denom ? dot / denom : 0;
}

function hashEmbed(text: string, dimensions = 32): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i += 1) {
    vec[i % dimensions] += ((normalized.charCodeAt(i) % 31) - 15) / 15;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

async function embedText(
  text: string,
): Promise<{ vector: number[]; engine: string }> {
  const apiKey = Deno.env.get("MEMORY_OS_OPENAI_API_KEY")?.trim() ??
    Deno.env.get("OPENAI_API_KEY")?.trim();
  const requested = Number(
    Deno.env.get("MEMORY_OS_OPENAI_EMBED_DIMS") ?? "1536",
  );
  const dims = requested === 32 || requested === 1536 ? requested : 1536;
  if (!apiKey) return { vector: hashEmbed(text, 32), engine: "stub-hash" };
  const model = Deno.env.get("MEMORY_OS_OPENAI_EMBED_MODEL") ??
    "text-embedding-3-small";
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, input: [text], dimensions: dims }),
    });
    if (!res.ok) {
      return { vector: hashEmbed(text, 32), engine: "stub-hash-fallback" };
    }
    const payload = await res.json() as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = payload.data?.[0]?.embedding ?? [];
    return vector.length
      ? { vector, engine: "openai" }
      : { vector: hashEmbed(text, 32), engine: "stub-hash" };
  } catch {
    return { vector: hashEmbed(text, 32), engine: "stub-hash-fallback" };
  }
}

type Hit = { memory: Record<string, unknown>; score: number; reason: string };

function rerankRrf(hits: Hit[], queryVector: number[]): Hit[] {
  if (!hits.length || !queryVector.length) return hits;
  const lexical = [...hits].sort((a, b) => Number(b.score) - Number(a.score));
  const similarity = new Map<string, number>();
  for (const hit of hits) {
    const mem = hit.memory;
    const vec = asVector(mem.embedding_vector_hq ?? mem.embeddingVectorHq) ??
      asVector(mem.embedding_vector ?? mem.embeddingVector) ??
      asVector(mem.embedding);
    similarity.set(
      String(mem.id ?? ""),
      vec ? Math.max(0, cosine(queryVector, vec)) : 0,
    );
  }
  const vector = [...hits].sort((a, b) =>
    (similarity.get(String(b.memory.id ?? "")) ?? 0) -
    (similarity.get(String(a.memory.id ?? "")) ?? 0)
  );
  const score = new Map<string, number>();
  for (const list of [lexical, vector]) {
    list.forEach((hit, index) => {
      const id = String(hit.memory.id ?? `idx:${index}`);
      score.set(id, (score.get(id) ?? 0) + 1 / (60 + index + 1));
    });
  }
  return hits.map((hit) => {
    const id = String(hit.memory.id ?? "");
    return {
      ...hit,
      score: (score.get(id) ?? 0) + (similarity.get(id) ?? 0) * 0.01,
      reason: "hybrid:rpc+rrf",
    };
  }).sort((a, b) => b.score - a.score);
}

function packContext(hits: Hit[], maxChars = 4000): Record<string, unknown> {
  const limit = Math.min(Math.max(Number(maxChars) || 4000, 512), 16000);
  const citations: Array<Record<string, unknown>> = [];
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const hit of hits.slice(0, 12)) {
    const title = String(hit.memory.title ?? "untitled").trim() || "untitled";
    const body = String(hit.memory.content ?? "").trim();
    const prefix = `[${citations.length + 1}] ${title}\n`;
    const sep = parts.length ? 2 : 0;
    const room = limit - used - sep - prefix.length;
    if (room <= 0) {
      truncated = true;
      break;
    }
    let snippet = body;
    if (snippet.length > room) {
      snippet = `${snippet.slice(0, Math.max(0, room - 1))}…`;
      truncated = true;
    }
    const block = `${prefix}${snippet}`;
    parts.push(block);
    used += sep + block.length;
    citations.push({
      index: citations.length + 1,
      memoryId: hit.memory.id ? String(hit.memory.id) : null,
      title,
      score: Number(hit.score),
    });
    if (truncated) break;
  }
  if (citations.length < hits.length) truncated = true;
  return {
    text: parts.join("\n\n"),
    citations,
    truncated,
    packedCount: citations.length,
  };
}

async function callTool(
  client: SupabaseClient,
  secret: string,
  name: string,
  raw: Record<string, unknown>,
): Promise<unknown> {
  if (!tools.some((tool) => tool.name === name)) {
    throw new Error(`Tool ${name} is not available on MCP profile 'chatgpt'`);
  }
  const args = defaults(raw);
  const actor = String(args.actor_subject_id);
  const workspace = String(args.workspace_id);
  const resolveProjectId = (mode: "optional" | "required") =>
    resolveEdgeProjectId({
      args,
      mode,
      resolve: async (projectRef) =>
        await rpc(client, "api_resolve_project_ref", {
          p_secret: secret,
          p_subject_id: actor,
          p_workspace_id: workspace,
          p_project_ref: projectRef,
        }) as {
          projectId?: string | null;
          matchCount?: number | null;
          candidates?: Array<{
            id?: string | null;
            slug?: string | null;
            name?: string | null;
            url?: string | null;
          }> | null;
        },
    });

  switch (name) {
    case "memory.search": {
      const project = await resolveProjectId("optional");
      const query = String(args.query ?? "").trim();
      if (!query) throw new Error("query is required");
      const embedded = await embedText(query);
      const rawHits = await rpc(client, "api_search_memories", {
        p_secret: secret,
        p_subject_id: actor,
        p_query: query,
        p_project_id: project || null,
        p_include_history: Boolean(args.include_history),
        p_query_embedding: embedded.vector,
        p_recorded_after: args.recorded_after
          ? String(args.recorded_after)
          : null,
        p_recorded_before: args.recorded_before
          ? String(args.recorded_before)
          : null,
      });
      const hits = (Array.isArray(rawHits) ? rawHits : []).map((value) => {
        const row = value as Record<string, unknown>;
        return {
          memory: normalizeMemory(row.memory),
          score: Number(row.score ?? 0),
          reason: String(row.reason ?? "structured+text"),
        } satisfies Hit;
      });
      const ranked = rerankRrf(hits, embedded.vector);
      return {
        hits: ranked,
        ranking: "hybrid-rrf",
        ...(Boolean(args.pack_context)
          ? {
            context: packContext(
              ranked,
              Number(args.max_context_chars ?? 4000),
            ),
          }
          : {}),
      };
    }
    case "context.project": {
      const project = await resolveProjectId("required");
      return rpc(client, "api_project_context", {
        p_secret: secret,
        p_subject_id: actor,
        p_project_id: project,
      });
    }
    case "memory.store_decision": {
      const project = await resolveProjectId("required");
      const title = String(args.title ?? "").trim();
      const content = String(args.content ?? "").trim();
      const key = String(args.idempotency_key ?? "").trim();
      if (!title || !content || !key) {
        throw new Error("title, content and idempotency_key are required");
      }
      return rpc(client, "api_create_decision", {
        p_secret: secret,
        p_subject_id: actor,
        p_workspace_id: workspace,
        p_project_id: project,
        p_title: title,
        p_content: content,
        p_idempotency_key: key,
        p_importance: Number(args.importance ?? 0.8),
        p_confidence: Number(args.confidence ?? 0.9),
        p_sensitivity: String(args.sensitivity ?? "internal"),
        p_rationale: args.rationale ? String(args.rationale) : null,
      });
    }
    case "handoff.create": {
      const project = await resolveProjectId("required");
      const from = String(args.from_subject_id ?? "").trim();
      const key = String(args.idempotency_key ?? "").trim();
      const payload = args.payload;
      if (!from || !key || !payload || typeof payload !== "object") {
        throw new Error(
          "from_subject_id, idempotency_key and payload are required",
        );
      }
      return rpc(client, "api_create_handoff", {
        p_secret: secret,
        p_subject_id: from,
        p_workspace_id: workspace,
        p_project_id: project,
        p_to_subject_id: args.to_subject_id ? String(args.to_subject_id) : null,
        p_payload: {
          ...(payload as Record<string, unknown>),
          idempotency_key: key,
        },
      });
    }
    case "capture.text": {
      const project = await resolveProjectId("required");
      const title = String(args.title ?? "").trim();
      const text = String(args.text ?? "").trim();
      const key = String(args.idempotency_key ?? "").trim();
      if (!title || !text || !key) {
        throw new Error("title, text and idempotency_key are required");
      }
      const result = await rpc(client, "api_capture_text", {
        p_secret: secret,
        p_subject_id: actor,
        p_workspace_id: workspace,
        p_project_id: project,
        p_title: title,
        p_text: text,
        p_idempotency_key: key,
        p_sensitivity: String(args.sensitivity ?? "internal"),
        p_process_now: args.process_now !== false,
        p_filename: null,
        p_mime_type: "text/plain",
      }) as Record<string, unknown>;
      let embedding: unknown = null;
      const process =
        (result.process && typeof result.process === "object"
          ? result.process
          : {}) as Record<string, unknown>;
      const memoryId = process.memoryId ?? process.memory_id;
      if (memoryId) {
        try {
          const embedded = await embedText(`${title}\n${text}`);
          embedding = await rpc(client, "api_set_memory_embedding", {
            p_secret: secret,
            p_subject_id: actor,
            p_memory_id: String(memoryId),
            p_embedding: embedded.vector,
            p_engine: embedded.engine,
          });
        } catch {
          embedding = null;
        }
      }
      return { ...result, embedding };
    }
    case "memory.set_status": {
      const id = String(args.memory_id ?? "").trim();
      const status = String(args.status ?? "").trim();
      const reason = String(args.reason ?? "").trim();
      if (!id || !status || !reason) {
        throw new Error("memory_id, status and reason are required");
      }
      return rpc(client, "api_set_memory_status", {
        p_secret: secret,
        p_subject_id: actor,
        p_memory_id: id,
        p_status: status,
        p_reason: reason,
      });
    }
    case "memory.get": {
      const id = String(args.memory_id ?? "").trim();
      if (!id) throw new Error("memory_id is required");
      const memory = await rpc(client, "api_get_memory", {
        p_secret: secret,
        p_subject_id: actor,
        p_memory_id: id,
      });
      return { memory, backend: "supabase" };
    }
    default:
      throw new Error(`Method not found: ${name}`);
  }
}

type RpcReq = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function ok(id: RpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function fail(id: RpcReq["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function protocol(requested: unknown): string {
  const value = String(requested ?? "").trim();
  return value === "2025-03-26" || value === "2024-11-05"
    ? value
    : "2024-11-05";
}

async function handleRpc(
  client: SupabaseClient,
  secret: string,
  msg: RpcReq,
): Promise<Record<string, unknown> | null> {
  const method = msg.method ?? "";
  switch (method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: protocol(msg.params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: {
          name: "memory-os-mcp-gateway",
          version: "0.0.0-edge",
          backend: "supabase",
          profile: "chatgpt",
        },
        instructions: EDGE_INSTRUCTIONS,
      });
    case "notifications/initialized":
    case "initialized":
      return null;
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(client, secret, name, args);
        return ok(msg.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        return fail(
          msg.id,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req: Request) => {
  const path = pathOf(req);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers":
          "authorization,content-type,accept,x-memory-os-api-secret,mcp-protocol-version",
      },
    });
  }

  if (
    req.method === "GET" &&
    (path === "/" || path === "/health" || path === "/mcp/health")
  ) {
    return json({
      ok: true,
      service: "memory-os-mcp",
      backend: "supabase",
      profile: "chatgpt",
      transport: "streamable-http",
      adapter: "supabase-edge",
    });
  }

  if (
    req.method === "GET" &&
    (path === "/.well-known/oauth-protected-resource" ||
      path === "/mcp/.well-known/oauth-protected-resource")
  ) {
    return json(resourceMetadata());
  }

  if (req.method === "GET" && path === "/oauth/consent") {
    const consentUrl = new URL(
      "https://2qjckdknjf-ctrl.github.io/sasha-memory-os/",
    );
    consentUrl.search = new URL(req.url).search;
    return new Response(null, {
      status: 302,
      headers: {
        location: consentUrl.toString(),
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  if (req.method === "GET" && path === "/mcp") {
    return json({ error: "method not allowed" }, 405, {
      allow: "POST",
      "www-authenticate": oauthChallenge(),
    });
  }

  if (req.method !== "POST" || path !== "/mcp") {
    return json({ error: "not found", path }, 404);
  }

  let msg: RpcReq;
  try {
    msg = await req.json() as RpcReq;
  } catch {
    return json(fail(null, -32700, "Parse error"), 400);
  }

  // Discovery and tool metadata do not expose private memory data. Keeping
  // them public lets ChatGPT scan the seven tools before the OAuth grant.
  if (
    [
      "initialize",
      "notifications/initialized",
      "initialized",
      "ping",
      "tools/list",
    ].includes(msg.method ?? "")
  ) {
    const result = await handleRpc({} as SupabaseClient, "", msg);
    if (result === null) return new Response(null, { status: 202 });
    return json(result);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceRoleKey) {
    return json({ error: "missing supabase service role env" }, 500);
  }
  const client = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = await authenticate(req, client);
  if (!auth) {
    if (msg.method === "tools/call") {
      return json(
        authRequiredResult(
          msg.id,
          "Sign in to Sasha Memory OS to use this tool.",
        ),
      );
    }
    return unauthorized();
  }

  const result = await handleRpc(client, auth.rpcSecret, msg);
  if (result === null) return new Response(null, { status: 202 });
  return json(result);
});

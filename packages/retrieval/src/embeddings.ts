export type EmbedInput = {
  texts: string[];
};

export type EmbedResult = {
  engine: string;
  dimensions: number;
  vectors: number[][];
};

export interface EmbeddingAdapter {
  readonly name: string;
  embed(input: EmbedInput): Promise<EmbedResult>;
}

/** Deterministic hash embedding for local tests — not for production retrieval quality. */
export class StubEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'stub-hash';
  private readonly dimensions: number;

  constructor(dimensions = 32) {
    this.dimensions = dimensions;
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const vectors = input.texts.map((text) => hashEmbed(text, this.dimensions));
    return { engine: this.name, dimensions: this.dimensions, vectors };
  }
}

export class NoopEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'noop';

  async embed(input: EmbedInput): Promise<EmbedResult> {
    return {
      engine: this.name,
      dimensions: 0,
      vectors: input.texts.map(() => []),
    };
  }
}

/** pgvector column + HNSW index are locked to 32 dims in alpha migrations. */
export const SQL_HYBRID_EMBED_DIMS = 32;

export class OpenAiEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly dimensions: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    /** Shortened dims for text-embedding-3-* (default matches pgvector(32)). */
    dimensions?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'text-embedding-3-small';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.dimensions = options.dimensions ?? SQL_HYBRID_EMBED_DIMS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(input: EmbedInput): Promise<EmbedResult> {
    if (input.texts.length === 0) {
      return { engine: this.name, dimensions: 0, vectors: [] };
    }
    const body: Record<string, unknown> = {
      model: this.model,
      input: input.texts,
    };
    // text-embedding-3-* supports shortened dimensions for SQL hybrid parity.
    if (this.dimensions > 0) {
      body.dimensions = this.dimensions;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embeddings failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const rows = [...(payload.data ?? [])].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    const vectors = rows.map((row) => row.embedding ?? []);
    const dimensions = vectors[0]?.length ?? 0;
    return { engine: this.name, dimensions, vectors };
  }
}

function hashEmbed(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    vec[i % dimensions] += ((code % 31) - 15) / 15;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

function readProcessEnv(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
}

export function createEmbeddingAdapter(engine?: string): EmbeddingAdapter {
  const env = readProcessEnv();
  const resolved = (engine ?? env?.MEMORY_OS_EMBED_ENGINE ?? 'stub')
    .trim()
    .toLowerCase();
  switch (resolved) {
    case 'stub':
      return new StubEmbeddingAdapter();
    case 'noop':
      return new NoopEmbeddingAdapter();
    case 'openai': {
      const apiKey = env?.MEMORY_OS_OPENAI_API_KEY?.trim();
      if (!apiKey) {
        const strict =
          (env?.MEMORY_OS_EMBED_STRICT ?? '').trim() === '1' ||
          (env?.MEMORY_OS_EMBED_STRICT ?? '').trim().toLowerCase() === 'true';
        if (strict) {
          throw new Error(
            'MEMORY_OS_EMBED_ENGINE=openai requires MEMORY_OS_OPENAI_API_KEY (or unset MEMORY_OS_EMBED_STRICT)',
          );
        }
        return new StubEmbeddingAdapter();
      }
      const dimsRaw = env?.MEMORY_OS_OPENAI_EMBED_DIMS?.trim();
      const dimensions = dimsRaw ? Number(dimsRaw) : SQL_HYBRID_EMBED_DIMS;
      return new OpenAiEmbeddingAdapter({
        apiKey,
        model: env?.MEMORY_OS_OPENAI_EMBED_MODEL?.trim() || undefined,
        baseUrl: env?.MEMORY_OS_OPENAI_BASE_URL?.trim() || undefined,
        dimensions:
          Number.isFinite(dimensions) && dimensions > 0
            ? dimensions
            : SQL_HYBRID_EMBED_DIMS,
      });
    }
    default:
      return new StubEmbeddingAdapter();
  }
}

/** Cosine similarity for stub vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

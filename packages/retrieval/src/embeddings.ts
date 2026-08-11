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

export function createEmbeddingAdapter(engine?: string): EmbeddingAdapter {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const resolved = engine ?? env?.MEMORY_OS_EMBED_ENGINE;
  switch (resolved ?? 'stub') {
    case 'stub':
      return new StubEmbeddingAdapter();
    case 'noop':
      return new NoopEmbeddingAdapter();
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

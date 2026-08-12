export type ExtractedMemoryType =
  | 'fact'
  | 'decision'
  | 'preference'
  | 'idea'
  | 'task'
  | 'event';

export type ExtractionCandidate = {
  title: string;
  content: string;
  memoryType: ExtractedMemoryType;
  confidence: number;
};

export type ExtractionInput = {
  title?: string;
  text: string;
};

export type ExtractionResult = {
  engine: string;
  candidates: ExtractionCandidate[];
};

export interface ExtractionAdapter {
  readonly name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

const MEMORY_TYPES: ExtractedMemoryType[] = [
  'fact',
  'decision',
  'preference',
  'idea',
  'task',
  'event',
];

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function normalizeType(raw: unknown): ExtractedMemoryType {
  const value = String(raw ?? 'fact')
    .trim()
    .toLowerCase();
  return (MEMORY_TYPES.find((t) => t === value) ?? 'fact') as ExtractedMemoryType;
}

/** Heuristic / no-LLM path — one candidate from the source text. */
export class StubExtractionAdapter implements ExtractionAdapter {
  readonly name = 'stub-extraction';

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const text = input.text.trim();
    if (!text) {
      return { engine: this.name, candidates: [] };
    }
    const title =
      input.title?.trim() ||
      text.split(/[.!?\n]/u).map((s) => s.trim()).find(Boolean)?.slice(0, 80) ||
      'Untitled extract';
    return {
      engine: this.name,
      candidates: [
        {
          title,
          content: text.slice(0, 4000),
          memoryType: 'fact',
          confidence: 0.4,
        },
      ],
    };
  }
}

/**
 * Deterministic fixture for tests/evals: split on blank lines into facts.
 */
export class FixtureExtractionAdapter implements ExtractionAdapter {
  readonly name = 'fixture-extraction';

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const blocks = input.text
      .split(/\n\s*\n/u)
      .map((b) => b.trim())
      .filter(Boolean);
    const candidates = blocks.slice(0, 8).map((block, i) => {
      const first = block.split(/[.!?\n]/u).map((s) => s.trim()).find(Boolean);
      return {
        title: first?.slice(0, 80) || `${input.title ?? 'Extract'} #${i + 1}`,
        content: block.slice(0, 4000),
        memoryType: 'fact' as const,
        confidence: 0.7,
      };
    });
    return { engine: this.name, candidates };
  }
}

/** OpenAI chat completions JSON extraction (provider-neutral contract). */
export class OpenAiExtractionAdapter implements ExtractionAdapter {
  readonly name = 'openai-extraction';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4o-mini';
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const prompt = [
      'Extract durable memory candidates as JSON: {"candidates":[{"title":"...","content":"...","memoryType":"fact|decision|preference|idea|task|event","confidence":0-1}]}',
      'Prefer stable facts/decisions; skip chit-chat. Max 8 candidates.',
      input.title ? `Title: ${input.title}` : null,
      'Text:',
      input.text.slice(0, 12000),
    ]
      .filter(Boolean)
      .join('\n');

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You extract structured long-term memory candidates.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI extraction failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content ?? '{}';
    let parsed: { candidates?: unknown[] };
    try {
      parsed = JSON.parse(raw) as { candidates?: unknown[] };
    } catch {
      throw new Error('OpenAI extraction returned invalid JSON');
    }
    const candidates = (parsed.candidates ?? [])
      .slice(0, 8)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          title: String(item.title ?? 'Untitled').slice(0, 200),
          content: String(item.content ?? '').slice(0, 4000),
          memoryType: normalizeType(item.memoryType ?? item.memory_type),
          confidence: clampConfidence(Number(item.confidence ?? 0.5)),
        };
      })
      .filter((c) => c.content.trim().length > 0);
    return { engine: this.name, candidates };
  }
}

function readProcessEnv(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
}

export function createExtractionAdapter(
  env: Record<string, string | undefined> = readProcessEnv() ?? {},
  options?: { fetchImpl?: typeof fetch },
): ExtractionAdapter {
  const engine = (env.MEMORY_OS_EXTRACT_ENGINE ?? 'stub').trim().toLowerCase();
  switch (engine) {
    case 'fixture':
      return new FixtureExtractionAdapter();
    case 'openai': {
      const apiKey = env.MEMORY_OS_OPENAI_API_KEY?.trim();
      if (!apiKey) {
        const strict =
          (env.MEMORY_OS_EXTRACT_STRICT ?? '').trim() === '1' ||
          (env.MEMORY_OS_EXTRACT_STRICT ?? '').trim().toLowerCase() === 'true';
        if (strict) {
          throw new Error(
            'MEMORY_OS_EXTRACT_ENGINE=openai requires MEMORY_OS_OPENAI_API_KEY',
          );
        }
        return new StubExtractionAdapter();
      }
      return new OpenAiExtractionAdapter({
        apiKey,
        model: env.MEMORY_OS_EXTRACT_MODEL?.trim() || 'gpt-4o-mini',
        baseUrl: env.MEMORY_OS_OPENAI_BASE_URL?.trim() || undefined,
        fetchImpl: options?.fetchImpl,
      });
    }
    case 'stub':
    case '':
      return new StubExtractionAdapter();
    default:
      return new StubExtractionAdapter();
  }
}

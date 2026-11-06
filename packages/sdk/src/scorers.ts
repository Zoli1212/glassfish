import type { Scorer, ScoreOutput, TaskContext } from './eval-types';

/**
 * Built-in scorers.
 *
 * Every one of them returns a value in 0..1 so means and pass-rates stay
 * comparable across scorers, and carries its own name so a result table reads
 * without a legend.
 */

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalise(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/** Output equals the expected value, ignoring surrounding and repeated whitespace. */
export function exactMatch(options: { caseSensitive?: boolean; name?: string } = {}): Scorer {
  const caseSensitive = options.caseSensitive ?? false;
  return {
    name: options.name ?? 'exact_match',
    score: ({ output, expected }) => ({
      value:
        normalise(text(output), caseSensitive) === normalise(text(expected), caseSensitive)
          ? 1
          : 0,
    }),
  };
}

/** Output contains the expected value as a substring. */
export function contains(options: { caseSensitive?: boolean; name?: string } = {}): Scorer {
  const caseSensitive = options.caseSensitive ?? false;
  return {
    name: options.name ?? 'contains',
    score: ({ output, expected }) => {
      const needle = normalise(text(expected), caseSensitive);
      if (!needle) return { value: null, comment: 'no expected value on this example' };
      return { value: normalise(text(output), caseSensitive).includes(needle) ? 1 : 0 };
    },
  };
}

/** Output matches a regular expression. */
export function regexMatch(pattern: RegExp, options: { name?: string } = {}): Scorer {
  return {
    name: options.name ?? 'regex_match',
    score: ({ output }) => ({ value: pattern.test(text(output)) ? 1 : 0 }),
  };
}

/** Output parses as JSON — the cheap guard for structured-output prompts. */
export function jsonValid(options: { name?: string } = {}): Scorer {
  return {
    name: options.name ?? 'json_valid',
    score: ({ output }) => {
      try {
        JSON.parse(text(output));
        return { value: 1 };
      } catch (error) {
        return { value: 0, comment: error instanceof Error ? error.message : 'invalid JSON' };
      }
    },
  };
}

/** Normalised Levenshtein similarity against the expected value, 0..1. */
export function similarity(options: { name?: string; caseSensitive?: boolean } = {}): Scorer {
  const caseSensitive = options.caseSensitive ?? false;
  return {
    name: options.name ?? 'similarity',
    score: ({ output, expected }) => {
      const a = normalise(text(output), caseSensitive);
      const b = normalise(text(expected), caseSensitive);
      if (!b) return { value: null, comment: 'no expected value on this example' };
      if (!a) return { value: 0 };
      const distance = levenshtein(a, b);
      return { value: 1 - distance / Math.max(a.length, b.length) };
    },
  };
}

/** Pass when the call finished within the budget. */
export function maxLatency(ms: number, options: { name?: string } = {}): Scorer {
  return {
    name: options.name ?? 'latency_ok',
    score: ({ latencyMs }) => ({
      value: latencyMs <= ms ? 1 : 0,
      comment: latencyMs <= ms ? undefined : `${Math.round(latencyMs)}ms exceeds the ${ms}ms budget`,
    }),
  };
}

/**
 * Judge the output with a model.
 *
 * The client is **yours** — the dashboard never holds a provider key, so the
 * judge runs on your credentials in your process. Judge cost is reported
 * separately so an experiment's bill does not quietly fold in the grading.
 */
export function llmJudge(options: {
  client: unknown;
  model: string;
  criteria: string;
  name?: string;
  maxTokens?: number;
  /** Cost of the judge call, if you want it counted. */
  costPerCall?: number;
}): Scorer {
  const { client, model, criteria } = options;

  return {
    name: options.name ?? 'llm_judge',
    async score({ input, output, expected }) {
      const prompt = [
        'You are grading one output against a set of criteria.',
        '',
        '<criteria>',
        criteria,
        '</criteria>',
        '',
        '<input>',
        text(input).slice(0, 8_000),
        '</input>',
        '',
        expected !== undefined && expected !== null
          ? `<expected>\n${text(expected).slice(0, 8_000)}\n</expected>\n`
          : '',
        '<output>',
        text(output).slice(0, 8_000),
        '</output>',
        '',
        'Reply with JSON only, no prose, in exactly this shape:',
        '{"score": <number between 0 and 1>, "reason": "<one sentence>"}',
      ].join('\n');

      const raw = await callJudge(client, model, prompt, options.maxTokens ?? 512);
      const parsed = parseJudgeReply(raw);

      return {
        value: parsed.score,
        comment: parsed.reason,
        judgeModel: model,
        judgeCostUsd: options.costPerCall ?? 0,
      } satisfies ScoreOutput;
    },
  };
}

async function callJudge(
  client: unknown,
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  const anyClient = client as Record<string, any>;

  if (anyClient?.messages?.create) {
    const message = await anyClient.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = Array.isArray(message?.content)
      ? message.content.find((b: { type?: string }) => b?.type === 'text')
      : undefined;
    return block?.text ?? '';
  }

  if (anyClient?.chat?.completions?.create) {
    const completion = await anyClient.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion?.choices?.[0]?.message?.content ?? '';
  }

  throw new Error(
    'llmJudge: client must expose messages.create (Anthropic) or chat.completions.create (OpenAI)',
  );
}

/**
 * Pull a score out of the judge's reply.
 *
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse
 * would fail on a perfectly good judgement, so the first JSON object in the
 * text wins. A reply that yields no number scores `null` — unknown, not zero,
 * because a parse failure is not evidence the output was bad.
 */
function parseJudgeReply(raw: string): { score: number | null; reason?: string } {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { score?: unknown; reason?: unknown };
      const score = Number(parsed.score);
      if (Number.isFinite(score)) {
        return {
          score: Math.min(1, Math.max(0, score)),
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        };
      }
    } catch {
      // fall through to the bare-number search
    }
  }

  const number = /(-?\d+(?:\.\d+)?)/.exec(raw);
  if (number) {
    const score = Number(number[1]);
    if (Number.isFinite(score)) return { score: Math.min(1, Math.max(0, score)) };
  }

  return { score: null, reason: `judge reply was not parseable: ${raw.slice(0, 120)}` };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/** Write your own: anything with a name and a score function qualifies. */
export function custom(
  name: string,
  score: (context: TaskContext) => ScoreOutput | Promise<ScoreOutput>,
): Scorer {
  return { name, score };
}

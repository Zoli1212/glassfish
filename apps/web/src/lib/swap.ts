import { getDb } from './db';
import { computeCost, fallbackCharsPerToken, listPrices, type ModelPrice } from './pricing';

/**
 * Model-swap analysis.
 *
 * The question "what would this have cost on a different model?" has two
 * parts, and conflating them is how naive estimates go wrong:
 *
 *   1. Price.  Known exactly, from the price table.
 *   2. Tokens. Model-specific. The same prompt tokenises differently on
 *      different models — the Opus 4.7-era Anthropic tokenizer produces
 *      roughly 1.0–1.35x the tokens of the previous one for identical text.
 *
 * So we never reuse the source model's token counts against a target model's
 * prices. Instead we convert through characters, which are model-independent:
 *
 *      projected_tokens(target) = chars / chars_per_token(target)
 *
 * `chars_per_token(target)` is **measured from this project's own traffic**
 * whenever the project has enough spans on that model, and only falls back to
 * a tokenizer-family constant otherwise. Every projection reports which basis
 * it used, so a family-constant guess is never mistaken for a measurement.
 */

/** Below this many spans, a measured ratio is too noisy to prefer over the family default. */
const MIN_SAMPLES_FOR_MEASURED = 20;

export interface ModelRatio {
  model: string;
  inputCharsPerToken: number;
  outputCharsPerToken: number;
  samples: number;
  basis: 'measured' | 'family';
}

interface RatioRow {
  model: string;
  samples: number;
  input_chars: number;
  prompt_tokens: number;
  output_chars: number;
  output_tokens: number;
}

/**
 * SQL fragment pairing characters with the tokens they actually produced.
 *
 * A call that failed before the provider reported usage still carries prompt
 * characters but no token counts. Summing those characters into the
 * denominator-free numerator inflates chars-per-token — a project with a
 * visible error rate would measure its models as systematically less dense
 * than they are, and every swap projection built on that ratio would be
 * wrong in the same direction. So each side is summed only over the spans
 * that reported tokens for that side.
 */
const PROMPT_TOKENS = 'input_tokens + cache_read_tokens + cache_write_tokens';

const RATIO_COLUMNS = `
  SUM(CASE WHEN (${PROMPT_TOKENS}) > 0 THEN 1 ELSE 0 END)           AS samples,
  COALESCE(SUM(CASE WHEN (${PROMPT_TOKENS}) > 0 THEN input_chars ELSE 0 END), 0) AS input_chars,
  COALESCE(SUM(${PROMPT_TOKENS}), 0)                                AS prompt_tokens,
  COALESCE(SUM(CASE WHEN output_tokens > 0 THEN output_chars ELSE 0 END), 0) AS output_chars,
  COALESCE(SUM(output_tokens), 0)                                   AS output_tokens`;

/**
 * Characters-per-token per model, measured from recorded spans.
 *
 * Prompt tokens include cache reads and writes: a cached call reports a small
 * `input_tokens` for the full prompt text, so ignoring cache tokens would
 * make the model look three times denser than it is.
 */
export function measureRatios(projectId: string, since = 0): Map<string, ModelRatio> {
  const rows = getDb()
    .prepare<[string, number], RatioRow>(
      `SELECT model, ${RATIO_COLUMNS}
       FROM spans
       WHERE project_id = ?
         AND started_at >= ?
         AND kind = 'llm'
         AND model IS NOT NULL
         AND input_chars > 0
       GROUP BY model`,
    )
    .all(projectId, since);

  const prices = new Map(listPrices().map((p) => [p.model, p]));
  const result = new Map<string, ModelRatio>();

  for (const row of rows) {
    const fallback = fallbackCharsPerToken(prices.get(row.model) ?? null);
    const measuredInput = ratio(row.input_chars, row.prompt_tokens);
    const measuredOutput = ratio(row.output_chars, row.output_tokens);
    const trustworthy = row.samples >= MIN_SAMPLES_FOR_MEASURED && measuredInput !== null;

    result.set(row.model, {
      model: row.model,
      inputCharsPerToken: trustworthy ? measuredInput! : fallback,
      // Output text is often shorter and noisier; only trust a measured
      // output ratio when the input ratio already earned trust.
      outputCharsPerToken: trustworthy && measuredOutput !== null ? measuredOutput : fallback,
      samples: row.samples,
      basis: trustworthy ? 'measured' : 'family',
    });
  }

  return result;
}

function ratio(chars: number, tokens: number): number | null {
  if (!Number.isFinite(chars) || !Number.isFinite(tokens)) return null;
  if (chars <= 0 || tokens <= 0) return null;
  const value = chars / tokens;
  // Anything outside this band means the two measurements are not describing
  // the same text (e.g. image-only prompts inflating tokens with no chars).
  if (value < 0.5 || value > 20) return null;
  return value;
}

export function ratioFor(
  model: string,
  ratios: Map<string, ModelRatio>,
  prices: Map<string, ModelPrice>,
): ModelRatio {
  const measured = ratios.get(model);
  if (measured) return measured;
  const fallback = fallbackCharsPerToken(prices.get(model) ?? null);
  return {
    model,
    inputCharsPerToken: fallback,
    outputCharsPerToken: fallback,
    samples: 0,
    basis: 'family',
  };
}

// ------------------------------------------------------------- the workload

export interface Workload {
  models: string[];
  calls: number;
  inputChars: number;
  outputChars: number;
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  pricedCalls: number;
  maxPromptTokens: number;
  maxOutputTokens: number;
  /** Share of prompt tokens that were served from cache, 0–1. */
  cacheHitShare: number;
}

interface WorkloadRow {
  calls: number;
  input_chars: number;
  output_chars: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  priced_calls: number;
  max_prompt: number;
  max_output: number;
}

export function loadWorkload(
  projectId: string,
  since: number,
  models: string[] | null,
): Workload {
  const params: (string | number)[] = [projectId, since];
  let modelClause = 'AND model IS NOT NULL';
  if (models && models.length > 0) {
    modelClause = `AND model IN (${models.map(() => '?').join(', ')})`;
    params.push(...models);
  }

  // Only calls that produced token usage take part: a call that failed before
  // the provider billed anything contributes no baseline cost, so including
  // its prompt characters would project spend the baseline never had.
  const row = getDb()
    .prepare<(string | number)[], WorkloadRow>(
      `SELECT
         COUNT(*)                              AS calls,
         COALESCE(SUM(input_chars), 0)         AS input_chars,
         COALESCE(SUM(output_chars), 0)        AS output_chars,
         COALESCE(SUM(input_tokens), 0)        AS input_tokens,
         COALESCE(SUM(output_tokens), 0)       AS output_tokens,
         COALESCE(SUM(cache_read_tokens), 0)   AS cache_read,
         COALESCE(SUM(cache_write_tokens), 0)  AS cache_write,
         COALESCE(SUM(cost_total), 0)          AS cost,
         COALESCE(SUM(priced), 0)              AS priced_calls,
         COALESCE(MAX(${PROMPT_TOKENS}), 0)    AS max_prompt,
         COALESCE(MAX(output_tokens), 0)       AS max_output
       FROM spans
       WHERE project_id = ? AND started_at >= ? AND kind = 'llm'
         AND (${PROMPT_TOKENS} + output_tokens) > 0 ${modelClause}`,
    )
    .get(...params);

  const promptTokens =
    (row?.input_tokens ?? 0) + (row?.cache_read ?? 0) + (row?.cache_write ?? 0);

  return {
    models: models ?? [],
    calls: row?.calls ?? 0,
    inputChars: row?.input_chars ?? 0,
    outputChars: row?.output_chars ?? 0,
    promptTokens,
    outputTokens: row?.output_tokens ?? 0,
    cacheReadTokens: row?.cache_read ?? 0,
    cacheWriteTokens: row?.cache_write ?? 0,
    cost: row?.cost ?? 0,
    pricedCalls: row?.priced_calls ?? 0,
    maxPromptTokens: row?.max_prompt ?? 0,
    maxOutputTokens: row?.max_output ?? 0,
    cacheHitShare: promptTokens > 0 ? (row?.cache_read ?? 0) / promptTokens : 0,
  };
}

// --------------------------------------------------------------- projection

export interface Projection {
  model: string;
  displayName: string;
  provider: string;
  family: string;
  basis: 'measured' | 'family';
  samples: number;
  inputCharsPerToken: number;
  outputCharsPerToken: number;
  projectedPromptTokens: number;
  projectedOutputTokens: number;
  projectedCacheReadTokens: number;
  projectedCacheWriteTokens: number;
  projectedTotalTokens: number;
  tokenDelta: number;
  tokenDeltaPct: number;
  projectedCost: number | null;
  costDelta: number | null;
  costDeltaPct: number | null;
  isBaseline: boolean;
  warnings: string[];
}

export interface SwapOptions {
  /**
   * Assumed change in generated output length on the target model, as a
   * multiplier. Tokenisation alone cannot capture this — a model that writes
   * longer answers by default costs more regardless of its tokenizer, so the
   * assumption is explicit instead of hidden.
   */
  verbosityFactor?: number;
  targets?: string[];
}

export function projectSwap(
  projectId: string,
  since: number,
  sourceModels: string[] | null,
  options: SwapOptions = {},
): { workload: Workload; projections: Projection[]; ratios: Map<string, ModelRatio> } {
  const verbosity = clamp(options.verbosityFactor ?? 1, 0.25, 4);
  const workload = loadWorkload(projectId, since, sourceModels);
  const ratios = measureRatios(projectId);
  const prices = new Map(listPrices().map((p) => [p.model, p]));

  const candidates = (options.targets && options.targets.length > 0
    ? options.targets.map((m) => prices.get(m)).filter((p): p is ModelPrice => Boolean(p))
    : [...prices.values()].filter((p) => p.active && p.inputPerMTok !== null));

  const baselineTokens =
    workload.promptTokens + workload.outputTokens;

  const projections = candidates.map<Projection>((price) => {
    const ratio = ratioFor(price.model, ratios, prices);
    const warnings: string[] = [];

    const projectedPromptTokens = workload.inputChars / ratio.inputCharsPerToken;
    const projectedOutputTokens =
      (workload.outputChars * verbosity) / ratio.outputCharsPerToken;

    // Preserve the observed cache-hit share: swapping model does not change
    // how repetitive the traffic is, only how it tokenises.
    const projectedCacheRead = projectedPromptTokens * workload.cacheHitShare;
    const cacheWriteShare =
      workload.promptTokens > 0 ? workload.cacheWriteTokens / workload.promptTokens : 0;
    const projectedCacheWrite = projectedPromptTokens * cacheWriteShare;
    const projectedFreshInput = Math.max(
      0,
      projectedPromptTokens - projectedCacheRead - projectedCacheWrite,
    );

    const cost = computeCost(price, {
      inputTokens: projectedFreshInput,
      outputTokens: projectedOutputTokens,
      cacheReadTokens: projectedCacheRead,
      cacheWriteTokens: projectedCacheWrite,
    });

    if (ratio.basis === 'family') {
      warnings.push(
        ratio.samples > 0
          ? `Only ${ratio.samples} span(s) on this model — using the ${price.family} tokenizer constant instead of a measured ratio.`
          : `No traffic on this model yet — using the ${price.family} tokenizer constant.`,
      );
    }
    if (!price.verified) {
      warnings.push('Price is unverified — confirm it against the provider before acting on this.');
    }
    if (!cost.priced) {
      warnings.push('No price configured, so only the token projection is shown.');
    }
    if (price.contextWindow !== null && workload.maxPromptTokens > 0) {
      const sourceRatio = averageSourceRatio(workload, ratios, prices, sourceModels);
      const projectedMaxPrompt =
        (workload.maxPromptTokens * sourceRatio) / ratio.inputCharsPerToken;
      if (projectedMaxPrompt > price.contextWindow) {
        warnings.push(
          `Largest observed prompt projects to ~${Math.round(projectedMaxPrompt).toLocaleString('en-US')} tokens, above this model's ${price.contextWindow.toLocaleString('en-US')}-token context window.`,
        );
      }
    }

    const projectedTotalTokens = projectedPromptTokens + projectedOutputTokens;
    const isBaseline = sourceModels?.length === 1 && sourceModels[0] === price.model;

    return {
      model: price.model,
      displayName: price.displayName,
      provider: price.provider,
      family: price.family,
      basis: ratio.basis,
      samples: ratio.samples,
      inputCharsPerToken: ratio.inputCharsPerToken,
      outputCharsPerToken: ratio.outputCharsPerToken,
      projectedPromptTokens,
      projectedOutputTokens,
      projectedCacheReadTokens: projectedCacheRead,
      projectedCacheWriteTokens: projectedCacheWrite,
      projectedTotalTokens,
      tokenDelta: projectedTotalTokens - baselineTokens,
      tokenDeltaPct: baselineTokens > 0 ? (projectedTotalTokens / baselineTokens - 1) * 100 : 0,
      projectedCost: cost.priced ? cost.total : null,
      costDelta: cost.priced ? cost.total - workload.cost : null,
      costDeltaPct:
        cost.priced && workload.cost > 0 ? (cost.total / workload.cost - 1) * 100 : null,
      isBaseline,
      warnings,
    };
  });

  projections.sort((a, b) => {
    if (a.projectedCost === null && b.projectedCost === null) return 0;
    if (a.projectedCost === null) return 1;
    if (b.projectedCost === null) return -1;
    return a.projectedCost - b.projectedCost;
  });

  return { workload, projections, ratios };
}

/** Characters-per-token of the workload as actually run, for context-window math. */
function averageSourceRatio(
  workload: Workload,
  ratios: Map<string, ModelRatio>,
  prices: Map<string, ModelPrice>,
  sourceModels: string[] | null,
): number {
  if (workload.inputChars > 0 && workload.promptTokens > 0) {
    return workload.inputChars / workload.promptTokens;
  }
  const first = sourceModels?.[0];
  return first ? ratioFor(first, ratios, prices).inputCharsPerToken : 4;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ------------------------------------------- measured side-by-side evidence

export interface ObservedModel {
  model: string;
  calls: number;
  avgPromptTokens: number;
  avgOutputTokens: number;
  avgPromptChars: number;
  avgOutputChars: number;
  inputCharsPerToken: number | null;
  outputCharsPerToken: number | null;
  avgCostPerCall: number | null;
  avgLatencyMs: number;
  errorRate: number;
}

/**
 * What each model actually did on this project's own traffic.
 *
 * When a project has run the same workload on two models, this is the direct
 * answer to "how much do the tokens differ?" — no projection involved.
 */
export function observedModels(projectId: string, since: number): ObservedModel[] {
  const rows = getDb()
    .prepare<
      [string, number],
      {
        model: string;
        calls: number;
        samples: number;
        prompt_tokens: number;
        output_tokens: number;
        input_chars: number;
        output_chars: number;
        cost: number;
        priced_calls: number;
        avg_latency: number;
        errors: number;
      }
    >(
      `SELECT
         model,
         COUNT(*)                              AS calls,
         ${RATIO_COLUMNS},
         COALESCE(SUM(cost_total), 0)          AS cost,
         COALESCE(SUM(priced), 0)              AS priced_calls,
         COALESCE(AVG(duration_ms), 0)         AS avg_latency,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
       FROM spans
       WHERE project_id = ? AND started_at >= ? AND kind = 'llm' AND model IS NOT NULL
       GROUP BY model
       ORDER BY calls DESC`,
    )
    .all(projectId, since);

  return rows.map((row) => {
    // Averages divide by the calls that reported usage, so a failed call
    // cannot drag an average down as if it had been a cheap success.
    const billed = row.samples || row.calls;
    return {
      model: row.model,
      calls: row.calls,
      avgPromptTokens: billed > 0 ? row.prompt_tokens / billed : 0,
      avgOutputTokens: billed > 0 ? row.output_tokens / billed : 0,
      avgPromptChars: billed > 0 ? row.input_chars / billed : 0,
      avgOutputChars: billed > 0 ? row.output_chars / billed : 0,
      inputCharsPerToken: ratio(row.input_chars, row.prompt_tokens),
      outputCharsPerToken: ratio(row.output_chars, row.output_tokens),
      avgCostPerCall: row.priced_calls > 0 ? row.cost / row.priced_calls : null,
      avgLatencyMs: row.avg_latency,
      errorRate: row.calls > 0 ? row.errors / row.calls : 0,
    };
  });
}

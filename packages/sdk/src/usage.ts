import type { TokenUsage } from './types';
import { isPlainObject, textLength, toNumber } from './utils';

/**
 * Normalise the usage object every major provider returns under a different
 * name, so the collector only ever sees one shape.
 *
 * Handles:
 *  - Anthropic Messages  : input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens
 *  - OpenAI chat         : prompt_tokens / completion_tokens (+ *_tokens_details)
 *  - OpenAI responses    : input_tokens / output_tokens (+ *_tokens_details)
 */
export function normaliseUsage(raw: unknown): TokenUsage {
  if (!isPlainObject(raw)) return {};

  const inputDetails = isPlainObject(raw.input_tokens_details)
    ? raw.input_tokens_details
    : isPlainObject(raw.prompt_tokens_details)
      ? raw.prompt_tokens_details
      : {};
  const outputDetails = isPlainObject(raw.output_tokens_details)
    ? raw.output_tokens_details
    : isPlainObject(raw.completion_tokens_details)
      ? raw.completion_tokens_details
      : {};

  const cacheRead =
    toNumber(raw.cache_read_input_tokens) ?? toNumber(inputDetails.cached_tokens) ?? 0;
  const cacheWrite = toNumber(raw.cache_creation_input_tokens) ?? 0;

  // OpenAI counts cached tokens *inside* prompt_tokens; Anthropic reports them
  // alongside input_tokens. Normalise to Anthropic's convention — cacheRead and
  // inputTokens are disjoint — so the cost engine never double-charges.
  let inputTokens = toNumber(raw.input_tokens) ?? toNumber(raw.prompt_tokens) ?? 0;
  if (raw.cache_read_input_tokens === undefined && cacheRead > 0) {
    inputTokens = Math.max(0, inputTokens - cacheRead);
  }

  return {
    inputTokens,
    outputTokens: toNumber(raw.output_tokens) ?? toNumber(raw.completion_tokens) ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: toNumber(outputDetails.reasoning_tokens) ?? 0,
  };
}

export function mergeUsage(base: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: pickLarger(base.inputTokens, next.inputTokens),
    outputTokens: pickLarger(base.outputTokens, next.outputTokens),
    cacheReadTokens: pickLarger(base.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: pickLarger(base.cacheWriteTokens, next.cacheWriteTokens),
    reasoningTokens: pickLarger(base.reasoningTokens, next.reasoningTokens),
  };
}

// Streaming providers re-send cumulative counters; the last value wins, and
// taking the larger of the two is immune to a final frame that omits a field.
function pickLarger(a?: number, b?: number): number {
  return Math.max(a ?? 0, b ?? 0);
}

/** Character count of a request payload: system prompt + messages + tool schemas. */
export function requestChars(params: unknown): number {
  if (!isPlainObject(params)) return 0;
  let total = 0;
  for (const key of ['system', 'messages', 'input', 'prompt', 'instructions', 'tools']) {
    if (key in params) total += textLength(params[key]);
  }
  return total;
}

/** Character count of a completion payload across provider response shapes. */
export function responseChars(result: unknown): number {
  if (!isPlainObject(result)) return 0;
  if ('content' in result) return textLength(result.content);
  if ('output' in result) return textLength(result.output);
  if ('output_text' in result) return textLength(result.output_text);
  if ('choices' in result && Array.isArray(result.choices)) {
    let total = 0;
    for (const choice of result.choices) {
      if (!isPlainObject(choice)) continue;
      if (isPlainObject(choice.message)) total += textLength(choice.message.content);
      else if (isPlainObject(choice.delta)) total += textLength(choice.delta.content);
      else if (typeof choice.text === 'string') total += choice.text.length;
    }
    return total;
  }
  if ('data' in result && Array.isArray(result.data)) return 0; // embeddings: vectors, not text
  return 0;
}

export function extractModel(params: unknown, result: unknown): string | undefined {
  if (isPlainObject(result) && typeof result.model === 'string') return result.model;
  if (isPlainObject(params) && typeof params.model === 'string') return params.model;
  return undefined;
}

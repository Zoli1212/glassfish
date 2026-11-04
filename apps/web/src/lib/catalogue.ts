/**
 * Seed data for the model price table and the tokenizer families the
 * model-swap simulator projects across.
 *
 * Everything here is only a *starting point*: prices live in the `model_prices`
 * table and are editable in the UI. A row's `verified` flag says whether the
 * seeded number came from a first-party source we can cite. Unverified rows
 * are flagged in the dashboard wherever they contribute to a cost figure, so a
 * stale placeholder can never masquerade as a real bill.
 */

export interface TokenizerFamily {
  id: string;
  label: string;
  /**
   * Typical characters per token for mixed English prose and code.
   *
   * Only a fallback. Once a project has traffic on a model, the simulator uses
   * the ratio measured from that project's own spans instead — see
   * `lib/swap.ts`. A static constant across models is exactly the thing that
   * makes naive swap estimates wrong.
   */
  charsPerToken: number;
  note: string;
}

export const TOKENIZER_FAMILIES: TokenizerFamily[] = [
  {
    id: 'anthropic-2026',
    label: 'Anthropic (Opus 4.7+ tokenizer)',
    charsPerToken: 3.05,
    note: 'Introduced with Opus 4.7. Produces roughly 1.0–1.35× the tokens of the previous Anthropic tokenizer for the same text.',
  },
  {
    id: 'anthropic-2025',
    label: 'Anthropic (pre-4.7 tokenizer)',
    charsPerToken: 3.85,
    note: 'Opus 4.6 and earlier, Sonnet 4.6/4.5, Haiku 4.5.',
  },
  {
    id: 'openai-o200k',
    label: 'OpenAI o200k',
    charsPerToken: 4.0,
    note: 'Current OpenAI tokenizer family.',
  },
  {
    id: 'generic',
    label: 'Unknown tokenizer',
    charsPerToken: 4.0,
    note: 'Fallback for models with no family assigned. Projections against these carry low confidence.',
  },
];

export interface SeedPrice {
  model: string;
  provider: string;
  displayName: string;
  family: string;
  /** USD per million tokens. null means "not priced yet" — never silently 0. */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  contextWindow: number | null;
  maxOutput: number | null;
  verified: boolean;
  source: string;
}

const ANTHROPIC_SOURCE = 'Anthropic published API pricing (catalogue snapshot 2026-06-24)';
const OPENAI_SOURCE = 'Community-reported list price — UNVERIFIED, confirm on the provider pricing page';

/** Anthropic bills cache reads at 0.1× input and 5-minute cache writes at 1.25× input. */
function anthropic(
  model: string,
  displayName: string,
  family: string,
  input: number,
  output: number,
  contextWindow: number,
  maxOutput: number,
): SeedPrice {
  return {
    model,
    provider: 'anthropic',
    displayName,
    family,
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: round(input * 0.1),
    cacheWritePerMTok: round(input * 1.25),
    contextWindow,
    maxOutput,
    verified: true,
    source: ANTHROPIC_SOURCE,
  };
}

function openai(
  model: string,
  displayName: string,
  input: number,
  output: number,
  cacheRead: number,
  contextWindow: number,
  maxOutput: number,
): SeedPrice {
  return {
    model,
    provider: 'openai',
    displayName,
    family: 'openai-o200k',
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: cacheRead,
    // OpenAI's prompt cache has no write surcharge.
    cacheWritePerMTok: 0,
    contextWindow,
    maxOutput,
    verified: false,
    source: OPENAI_SOURCE,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export const SEED_PRICES: SeedPrice[] = [
  // ---- Anthropic -------------------------------------------------------
  anthropic('claude-fable-5', 'Claude Fable 5', 'anthropic-2026', 10, 50, 1_000_000, 128_000),
  anthropic('claude-mythos-5', 'Claude Mythos 5', 'anthropic-2026', 10, 50, 1_000_000, 128_000),
  anthropic('claude-opus-5', 'Claude Opus 5', 'anthropic-2026', 5, 25, 1_000_000, 128_000),
  anthropic('claude-opus-4-8', 'Claude Opus 4.8', 'anthropic-2026', 5, 25, 1_000_000, 128_000),
  anthropic('claude-opus-4-7', 'Claude Opus 4.7', 'anthropic-2026', 5, 25, 1_000_000, 128_000),
  anthropic('claude-opus-4-6', 'Claude Opus 4.6', 'anthropic-2025', 5, 25, 1_000_000, 128_000),
  anthropic('claude-opus-4-5', 'Claude Opus 4.5', 'anthropic-2025', 5, 25, 200_000, 64_000),
  anthropic('claude-sonnet-5', 'Claude Sonnet 5', 'anthropic-2026', 3, 15, 1_000_000, 128_000),
  anthropic('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic-2025', 3, 15, 1_000_000, 128_000),
  anthropic('claude-sonnet-4-5', 'Claude Sonnet 4.5', 'anthropic-2025', 3, 15, 200_000, 64_000),
  anthropic('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic-2025', 1, 5, 200_000, 64_000),

  // ---- OpenAI (unverified placeholders — confirm before trusting cost) --
  openai('gpt-4o', 'GPT-4o', 2.5, 10, 1.25, 128_000, 16_384),
  openai('gpt-4o-mini', 'GPT-4o mini', 0.15, 0.6, 0.075, 128_000, 16_384),
  openai('gpt-4.1', 'GPT-4.1', 2.0, 8, 0.5, 1_000_000, 32_768),
  openai('gpt-4.1-mini', 'GPT-4.1 mini', 0.4, 1.6, 0.1, 1_000_000, 32_768),
  openai('o3-mini', 'o3-mini', 1.1, 4.4, 0.55, 200_000, 100_000),
];

export const FAMILY_BY_ID = new Map(TOKENIZER_FAMILIES.map((f) => [f.id, f]));

export function familyCharsPerToken(familyId: string | null | undefined): number {
  return FAMILY_BY_ID.get(familyId ?? 'generic')?.charsPerToken ?? 4.0;
}

/**
 * Guess a tokenizer family for a model we have never seen, so an unpriced
 * model is still comparable. Deliberately conservative — unknown stays
 * unknown rather than being forced into a family.
 */
export function guessFamily(model: string, provider: string | null | undefined): string {
  const id = model.toLowerCase();
  if (provider === 'anthropic' || id.startsWith('claude')) {
    if (/opus-4-(7|8)|opus-5|sonnet-5|fable-5|mythos-5/.test(id)) return 'anthropic-2026';
    return 'anthropic-2025';
  }
  if (provider === 'openai' || /^(gpt|o\d|text-embedding)/.test(id)) return 'openai-o200k';
  return 'generic';
}

export function guessProvider(model: string): string {
  const id = model.toLowerCase();
  if (id.startsWith('claude') || id.startsWith('anthropic.')) return 'anthropic';
  if (/^(gpt|o\d|text-embedding|davinci|babbage)/.test(id)) return 'openai';
  if (id.startsWith('gemini')) return 'google';
  if (id.startsWith('mistral') || id.startsWith('magistral')) return 'mistral';
  if (id.startsWith('llama')) return 'meta';
  return 'unknown';
}
